import secrets
import urllib.parse
import os
import time
import sqlite3
from fastapi import FastAPI, HTTPException, Header, Depends, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from proxmoxer import ProxmoxAPI
from pydantic import BaseModel
import bcrypt
from typing import List
from cryptography.fernet import Fernet

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, restrict this to specific domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

DB_FILE = os.environ.get("PROXGLASS_DB_FILE", "app.db")
KEY_FILE = "secret.key"

DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASS = "admin"  # nosec B105 - default, user is instructed to change this


def _load_or_create_key() -> bytes:
    """Load the Fernet key from environment, disk, or generate and save a new one."""
    env_key = os.environ.get("PROXGLASS_SECRET_KEY")
    if env_key:
        return env_key.encode()

    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
            
    print("WARNING: Generating a new secret key and saving it to disk in plain text. It is recommended to set the PROXGLASS_SECRET_KEY environment variable in production.")
    key = Fernet.generate_key()
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    return key


_fernet = Fernet(_load_or_create_key())


def encrypt_password(plaintext: str) -> str:
    """Encrypt a plaintext password for storage."""
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_password(ciphertext: str) -> str:
    """Decrypt a stored encrypted password."""
    return _fernet.decrypt(ciphertext.encode()).decode()


def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute(
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user'
        )"""
    )
    # Migration: add role column if it doesn't exist
    c.execute("PRAGMA table_info(users)")
    columns = [col[1] for col in c.fetchall()]
    if "role" not in columns:
        c.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")

    c.execute(
        """CREATE TABLE IF NOT EXISTS servers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            pve_username TEXT NOT NULL,
            pve_password TEXT NOT NULL,
            verify_ssl BOOLEAN NOT NULL DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )"""
    )

    # Provision Master Admin
    c.execute("SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USER,))
    if not c.fetchone():
        hashed = bcrypt.hashpw(
            DEFAULT_ADMIN_PASS.encode("utf-8"), bcrypt.gensalt()
        ).decode("utf-8")
        c.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (DEFAULT_ADMIN_USER, hashed, "admin"),
        )

    conn.commit()
    conn.close()


init_db()

# In-memory session store mapping token -> {"user_id": int, "expires": float}
sessions = {}
SESSION_TIMEOUT = 86400  # 24 hours

failed_logins = {} # username -> {"attempts": int, "locked_until": float}
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_TIME = 300 # 5 minutes


def sweep_expired_sessions():
    """Remove all sessions that have passed their expiry time."""
    now = time.time()
    expired = [t for t, s in sessions.items() if now > s["expires"]]
    for t in expired:
        sessions.pop(t, None)


class UserAuth(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    new_password: str


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user"


class UserResponseInternal(BaseModel):
    id: int
    username: str
    role: str


class ServerCreate(BaseModel):
    name: str
    host: str
    pve_username: str
    pve_password: str
    verify_ssl: bool = False


class ServerResponse(BaseModel):
    id: int
    name: str
    host: str
    pve_username: str
    verify_ssl: bool


def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_current_user(authorization: str = Header(None), db: sqlite3.Connection = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = authorization.split(" ")[1]

    sweep_expired_sessions()

    now = time.time()
    session = sessions.get(token)
    if not session or now > session["expires"]:
        sessions.pop(token, None)
        raise HTTPException(
            status_code=401, detail="Session expired. Please log in again."
        )

    session["expires"] = now + SESSION_TIMEOUT
    
    # Fetch user data to ensure role and presence
    cursor = db.cursor()
    cursor.execute("SELECT id, username, role FROM users WHERE id = ?", (session["user_id"],))
    user = cursor.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
        
    return dict(user)


def get_current_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def get_proxmox_api(server, verify_ssl=None, is_encrypted=True):
    raw_host = server["host"].strip()
    if not raw_host.startswith(("http://", "https://")):
        raw_host = "https://" + raw_host

    parsed = urllib.parse.urlparse(raw_host)
    host = parsed.hostname
    port = parsed.port or 8006

    v_ssl = bool(verify_ssl if verify_ssl is not None else server["verify_ssl"])
    auth_kwargs = {"host": host, "port": port, "verify_ssl": v_ssl}

    username = server["pve_username"]
    raw_password = server["pve_password"]
    
    if is_encrypted:
        try:
            password = decrypt_password(raw_password)
        except Exception:
            raise ValueError("Failed to decrypt stored credentials")
    else:
        password = raw_password

    if "!" in username:
        auth_kwargs["token_name"] = username.split("!")[1]
        auth_kwargs["token_value"] = password
        auth_kwargs["user"] = username.split("!")[0]
    else:
        auth_kwargs["password"] = password
        auth_kwargs["user"] = username if "@" in username else f"{username}@pam"

    return ProxmoxAPI(**auth_kwargs)


@app.post("/api/app/login")
def login_user(req: UserAuth, db: sqlite3.Connection = Depends(get_db)):
    now = time.time()
    
    if req.username in failed_logins:
        info = failed_logins[req.username]
        if info["locked_until"] > now:
            raise HTTPException(status_code=429, detail="Too many failed attempts. Try again later.")
        elif info["locked_until"] != 0 and info["locked_until"] <= now:
            failed_logins.pop(req.username)

    cursor = db.cursor()
    cursor.execute(
        "SELECT id, password_hash, role FROM users WHERE username = ?", (req.username,)
    )
    user = cursor.fetchone()

    if not user or not bcrypt.checkpw(
        req.password.encode("utf-8"), user["password_hash"].encode("utf-8")
    ):
        info = failed_logins.get(req.username, {"attempts": 0, "locked_until": 0})
        info["attempts"] += 1
        if info["attempts"] >= MAX_FAILED_ATTEMPTS:
            info["locked_until"] = now + LOCKOUT_TIME
        failed_logins[req.username] = info
        
        time.sleep(1) # Delay to deter basic brute force
        raise HTTPException(status_code=401, detail="Invalid username or password")

    failed_logins.pop(req.username, None)
    token = secrets.token_urlsafe(32)
    sessions[token] = {"user_id": user["id"], "expires": time.time() + SESSION_TIMEOUT}
    return {"token": token, "role": user["role"]}


@app.get("/api/app/me")
def get_me(user: dict = Depends(get_current_user)):
    return user


@app.put("/api/users/me/password")
def change_password(
    req: PasswordChange,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    hashed = bcrypt.hashpw(
        req.new_password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    cursor = db.cursor()
    cursor.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?", (hashed, user["id"])
    )
    db.commit()
    return {"message": "Password updated"}


@app.get("/api/admin/users", response_model=List[UserResponseInternal])
def list_users(admin: dict = Depends(get_current_admin), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT id, username, role FROM users")
    return [dict(row) for row in cursor.fetchall()]


@app.post("/api/admin/users")
def create_user(
    req: UserCreate,
    admin: dict = Depends(get_current_admin),
    db: sqlite3.Connection = Depends(get_db),
):
    hashed = bcrypt.hashpw(
        req.password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")
    cursor = db.cursor()
    try:
        cursor.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (req.username, hashed, req.role),
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Username already exists")
    return {"message": "User created"}


@app.post("/api/app/logout")
def logout_user(authorization: str = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        sessions.pop(token, None)
    return {"message": "Logged out"}


@app.get("/api/servers", response_model=List[ServerResponse])
def get_servers(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.cursor()
    cursor.execute(
        "SELECT id, name, host, pve_username, verify_ssl FROM servers WHERE user_id = ?",
        (user["id"],),
    )
    return [dict(row) for row in cursor.fetchall()]


@app.post("/api/servers")
def add_server(
    req: ServerCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    try:
        # Test connection first (uses plaintext password from request)
        px = get_proxmox_api({
            "host": req.host,
            "pve_username": req.pve_username,
            "pve_password": req.pve_password,
            "verify_ssl": req.verify_ssl,
        }, is_encrypted=False)
        px.nodes.get()
    except Exception as e:
        print(f"Failed to connect to server during ADD: {e}")
        raise HTTPException(
            status_code=400,
            detail="Failed to connect to Proxmox server with these credentials.",
        )

    # Encrypt password before persisting to database
    encrypted_pw = encrypt_password(req.pve_password)

    cursor = db.cursor()
    cursor.execute(
        """INSERT INTO servers (user_id, name, host, pve_username, pve_password, verify_ssl)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (user["id"], req.name, req.host, req.pve_username, encrypted_pw, req.verify_ssl),
    )
    db.commit()
    return {"message": "Server added"}


@app.put("/api/servers/{server_id}")
def update_server(
    server_id: int,
    req: ServerCreate,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    # Verify owner
    cursor = db.cursor()
    cursor.execute("SELECT id FROM servers WHERE id = ? AND user_id = ?", (server_id, user["id"]))
    if not cursor.fetchone():
        raise HTTPException(status_code=404, detail="Server not found")

    try:
        # Test connection first
        px = get_proxmox_api({
            "host": req.host,
            "pve_username": req.pve_username,
            "pve_password": req.pve_password,
            "verify_ssl": req.verify_ssl,
        }, is_encrypted=False)
        px.nodes.get()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")

    encrypted_pw = encrypt_password(req.pve_password)
    cursor.execute(
        """UPDATE servers SET name = ?, host = ?, pve_username = ?, pve_password = ?, verify_ssl = ?
           WHERE id = ? AND user_id = ?""",
        (req.name, req.host, req.pve_username, encrypted_pw, req.verify_ssl, server_id, user["id"])
    )
    db.commit()
    return {"message": "Server updated"}


@app.delete("/api/servers/{server_id}")
def delete_server(
    server_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.cursor()
    cursor.execute(
        "DELETE FROM servers WHERE id = ? AND user_id = ?", (server_id, user["id"])
    )
    db.commit()
    return {"message": "Server deleted"}


@app.get("/api/dashboard")
def get_dashboard(
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM servers WHERE user_id = ?", (user["id"],))
    servers = cursor.fetchall()

    dashboard_data = []

    for server in servers:
        s_dict = dict(server)
        server_health = {
            "id": s_dict["id"],
            "name": s_dict["name"],
            "status": "offline",
            "nodes": [],
            "vms_running": 0,
            "vms_total": 0,
        }

        try:
            px = get_proxmox_api(s_dict)
            nodes = px.nodes.get()
            server_health["status"] = "online"

            for node in nodes:
                is_online = node.get("status") == "online"
                n_data = {
                    "node": node.get("node"),
                    "status": node.get("status"),
                    "cpu": float(node.get("cpu", 0)),
                    "mem": node.get("mem", 0),
                    "maxmem": node.get("maxmem", 0),
                }
                server_health["nodes"].append(n_data)

                if is_online:
                    try:
                        qemu = px.nodes(node.get("node")).qemu.get()
                        lxc = px.nodes(node.get("node")).lxc.get()
                        all_vms = qemu + lxc
                        server_health["vms_total"] += len(all_vms)
                        server_health["vms_running"] += sum(
                            1 for v in all_vms if v.get("status") == "running"
                        )
                    except Exception as e:
                        print(f"Could not fetch VMs for node {node.get('node')}: {e}")
        except Exception as e:
            print(f"Dashboard failed to connect to {s_dict['name']}: {e}")

        dashboard_data.append(server_health)

    return dashboard_data


@app.get("/api/servers/{server_id}/nodes")
def get_server_nodes(
    server_id: int,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.cursor()
    cursor.execute(
        "SELECT * FROM servers WHERE id = ? AND user_id = ?", (server_id, user["id"])
    )
    server = cursor.fetchone()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    try:
        px = get_proxmox_api(dict(server))
        return px.nodes.get()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/servers/{server_id}/nodes/{node}/vms")
def get_server_node_vms(
    server_id: int,
    node: str,
    user: dict = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
):
    cursor = db.cursor()
    cursor.execute(
        "SELECT * FROM servers WHERE id = ? AND user_id = ?", (server_id, user["id"])
    )
    server = cursor.fetchone()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")

    try:
        px = get_proxmox_api(dict(server))
        qemu = px.nodes(node).qemu.get()
        lxc = px.nodes(node).lxc.get()

        resources = []
        for vm in qemu:
            vm["type"] = "qemu"
            resources.append(vm)
        for ct in lxc:
            ct["type"] = "lxc"
            resources.append(ct)

        resources.sort(key=lambda x: int(x.get("vmid", 0)))
        return resources
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    debug_mode = os.environ.get("PROXGLASS_DEBUG", "0") == "1"
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=debug_mode)  # nosec B104
