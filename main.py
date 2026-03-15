import uuid
import urllib3
import urllib.parse
import os
import time
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.staticfiles import StaticFiles
from proxmoxer import ProxmoxAPI
from pydantic import BaseModel

# Disable insecure request warnings (common with self-signed PVE certs)
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI()

# In-memory session store (mapping session_id -> {"api": ProxmoxAPI instance, "expires": float timestamp})
sessions = {}
SESSION_TIMEOUT = 3600  # 1 hour

class LoginRequest(BaseModel):
    host: str
    username: str
    password: str
    verify_ssl: bool = False

@app.post("/api/login")
def login(req: LoginRequest):
    try:
        # Robustly parse host using urllib to support paths and IPv6
        raw_host = req.host.strip()
        if not raw_host.startswith(("http://", "https://")):
            raw_host = "https://" + raw_host
            
        parsed = urllib.parse.urlparse(raw_host)
        host = parsed.hostname
        port = parsed.port or 8006

        auth_kwargs = {"host": host, "port": port, "verify_ssl": req.verify_ssl}
        
        # Support API tokens: format user@realm!token_id
        if "!" in req.username:
            auth_kwargs["token_name"] = req.username.split("!")[1]
            auth_kwargs["token_value"] = req.password
            auth_kwargs["user"] = req.username.split("!")[0]
        else:
            auth_kwargs["password"] = req.password
            # Auto-append the @pam default realm if none is provided
            auth_kwargs["user"] = req.username if "@" in req.username else f"{req.username}@pam"

        px = ProxmoxAPI(**auth_kwargs)
        # Test connection by fetching cluster status or nodes
        px.nodes.get()
        
        session_id = str(uuid.uuid4())
        sessions[session_id] = {
            "api": px,
            "expires": time.time() + SESSION_TIMEOUT
        }
        return {"session_id": session_id}
    except Exception as e:
        print(f"Login failed: {e}")
        raise HTTPException(status_code=401, detail="Authentication failed. Please check credentials and host.")

def get_proxmox(authorization: str = Header(None)):
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
        
    # Extend session
    session["expires"] = now + SESSION_TIMEOUT
    return session["api"]

@app.post("/api/logout")
def logout(authorization: str = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        sessions.pop(token, None)
    return {"message": "Logged out"}

@app.get("/api/nodes")
def get_nodes(px: ProxmoxAPI = Depends(get_proxmox)):
    try:
        return px.nodes.get()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/nodes/{node}/status")
def get_node_status(node: str, px: ProxmoxAPI = Depends(get_proxmox)):
    try:
        return px.nodes(node).status.get()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/nodes/{node}/vms")
def get_vms(node: str, px: ProxmoxAPI = Depends(get_proxmox)):
    try:
        qemu = px.nodes(node).qemu.get()
        lxc = px.nodes(node).lxc.get()
        
        resources = []
        for vm in qemu:
            vm['type'] = 'qemu'
            resources.append(vm)
        for ct in lxc:
            ct['type'] = 'lxc'
            resources.append(ct)
            
        # Sort by VMID
        resources.sort(key=lambda x: int(x.get('vmid', 0)))
        return resources
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files to serve the frontend
os.makedirs("static", exist_ok=True)
app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
