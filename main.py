import uuid
import urllib.parse
import os
import time
import sqlite3
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.staticfiles import StaticFiles
from proxmoxer import ProxmoxAPI
from pydantic import BaseModel
import bcrypt
from typing import List

app = FastAPI()


DB_FILE = "app.db"

DEFAULT_ADMIN_USER = "admin"
DEFAULT_ADMIN_PASS = "admin"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL
                 )''')
    c.execute('''CREATE TABLE IF NOT EXISTS servers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    pve_username TEXT NOT NULL,
                    pve_password TEXT NOT NULL,
                    verify_ssl BOOLEAN NOT NULL DEFAULT 0,
                    FOREIGN KEY(user_id) REFERENCES users(id)
                 )''')
                 
    # Provision Master Admin
    c.execute("SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USER,))
    if not c.fetchone():
        hashed = bcrypt.hashpw(DEFAULT_ADMIN_PASS.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        c.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (DEFAULT_ADMIN_USER, hashed))

    conn.commit()
    conn.close()

init_db()

# In-memory session store mapping token -> {"user_id": int, "expires": float}
sessions = {}
SESSION_TIMEOUT = 86400  # 24 hours

class UserAuth(BaseModel):
    username: str
    password: str

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

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = authorization.split(" ")[1]
    
    now = time.time()
    session = sessions.get(token)
    if not session:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    if now > session["expires"]:
        sessions.pop(token, None)
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
        
    session["expires"] = now + SESSION_TIMEOUT
    return session["user_id"]

def get_proxmox_api(server, verify_ssl=None):
    raw_host = server["host"].strip()
    if not raw_host.startswith(("http://", "https://")):
        raw_host = "https://" + raw_host
        
    parsed = urllib.parse.urlparse(raw_host)
    host = parsed.hostname
    port = parsed.port or 8006
    
    v_ssl = bool(verify_ssl if verify_ssl is not None else server["verify_ssl"])

    auth_kwargs = {"host": host, "port": port, "verify_ssl": v_ssl}
    
    username = server["pve_username"]
    password = server["pve_password"]
    
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
    cursor = db.cursor()
    cursor.execute("SELECT id, password_hash FROM users WHERE username = ?", (req.username,))
    user = cursor.fetchone()
    
    if not user or not bcrypt.checkpw(req.password.encode('utf-8'), user["password_hash"].encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid username or password")
        
    token = str(uuid.uuid4())
    sessions[token] = {"user_id": user["id"], "expires": time.time() + SESSION_TIMEOUT}
    return {"token": token}

@app.post("/api/app/logout")
def logout_user(authorization: str = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        sessions.pop(token, None)
    return {"message": "Logged out"}

@app.get("/api/servers", response_model=List[ServerResponse])
def get_servers(user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT id, name, host, pve_username, verify_ssl FROM servers WHERE user_id = ?", (user_id,))
    return [dict(row) for row in cursor.fetchall()]

@app.post("/api/servers")
def add_server(req: ServerCreate, user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    try:
        # Test connection first
        px = get_proxmox_api({"host": req.host, "pve_username": req.pve_username, "pve_password": req.pve_password, "verify_ssl": req.verify_ssl})
        px.nodes.get()
    except Exception as e:
        print(f"Failed to connect to server during ADD: {e}")
        raise HTTPException(status_code=400, detail="Failed to connect to Proxmox server with these credentials.")

    cursor = db.cursor()
    cursor.execute('''INSERT INTO servers (user_id, name, host, pve_username, pve_password, verify_ssl) 
                      VALUES (?, ?, ?, ?, ?, ?)''', 
                   (user_id, req.name, req.host, req.pve_username, req.pve_password, req.verify_ssl))
    db.commit()
    return {"message": "Server added"}

@app.delete("/api/servers/{server_id}")
def delete_server(server_id: int, user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM servers WHERE id = ? AND user_id = ?", (server_id, user_id))
    db.commit()
    return {"message": "Server deleted"}

@app.get("/api/dashboard")
def get_dashboard(user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM servers WHERE user_id = ?", (user_id,))
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
            "vms_total": 0
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
                    "cpu": getattr(node, "cpu", float(node.get("cpu", 0))),
                    "mem": node.get("mem", 0),
                    "maxmem": node.get("maxmem", 0)
                }
                server_health["nodes"].append(n_data)
                
                if is_online:
                    try:
                        qemu = px.nodes(node.get("node")).qemu.get()
                        lxc = px.nodes(node.get("node")).lxc.get()
                        all_vms = qemu + lxc
                        server_health["vms_total"] += len(all_vms)
                        server_health["vms_running"] += sum(1 for v in all_vms if v.get("status") == "running")
                    except:
                        pass
        except Exception as e:
            print(f"Dashboard failed to connect to {s_dict['name']}: {e}")
            
        dashboard_data.append(server_health)
        
    return dashboard_data

@app.get("/api/servers/{server_id}/nodes")
def get_server_nodes(server_id: int, user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM servers WHERE id = ? AND user_id = ?", (server_id, user_id))
    server = cursor.fetchone()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    try:
        px = get_proxmox_api(dict(server))
        return px.nodes.get()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/servers/{server_id}/nodes/{node}/vms")
def get_server_node_vms(server_id: int, node: str, user_id: int = Depends(get_current_user), db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT * FROM servers WHERE id = ? AND user_id = ?", (server_id, user_id))
    server = cursor.fetchone()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
        
    try:
        px = get_proxmox_api(dict(server))
        qemu = px.nodes(node).qemu.get()
        lxc = px.nodes(node).lxc.get()
        
        resources = []
        for vm in qemu:
            vm['type'] = 'qemu'
            resources.append(vm)
        for ct in lxc:
            ct['type'] = 'lxc'
            resources.append(ct)
            
        resources.sort(key=lambda x: int(x.get('vmid', 0)))
        return resources
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=9000, reload=True)
