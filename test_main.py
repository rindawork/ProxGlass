import pytest
import sqlite3
import bcrypt
import secrets
import time
from fastapi.testclient import TestClient
from main import app, sessions, failed_logins, get_db

client = TestClient(app)

@pytest.fixture(autouse=True)
def clear_state():
    sessions.clear()
    failed_logins.clear()
    # Reset DB if needed? For simplicity, we assume default admin exists.

def get_admin_token():
    resp = client.post("/api/app/login", json={"username": "admin", "password": "admin"})
    return resp.json()["token"]

def test_login_success_with_role():
    response = client.post("/api/app/login", json={
        "username": "admin",
        "password": "admin"
    })
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    assert data["role"] == "admin"

def test_get_me():
    token = get_admin_token()
    response = client.get("/api/app/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    data = response.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"

def test_admin_access_only():
    # 1. Create a non-admin user (we need admin token to do this)
    admin_token = get_admin_token()
    client.post("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"}, json={
        "username": "testuser",
        "password": "testpassword",
        "role": "user"
    })
    
    # 2. Login as testuser
    resp = client.post("/api/app/login", json={"username": "testuser", "password": "testpassword"})
    user_token = resp.json()["token"]
    
    # 3. Try to access admin endpoint
    response = client.get("/api/admin/users", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 403
    
    # 4. Access as admin should work
    response = client.get("/api/admin/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    users = response.json()
    assert any(u["username"] == "testuser" for u in users)

def test_change_password():
    admin_token = get_admin_token()
    # Change password
    response = client.put("/api/users/me/password", headers={"Authorization": f"Bearer {admin_token}"}, json={
        "new_password": "newadminpassword"
    })
    assert response.status_code == 200
    
    # Verify old password fails
    resp = client.post("/api/app/login", json={"username": "admin", "password": "admin"})
    assert resp.status_code == 401
    
    # Verify new password works
    resp = client.post("/api/app/login", json={"username": "admin", "password": "newadminpassword"})
    assert resp.status_code == 200
    
    # Change it back for other tests
    new_token = resp.json()["token"]
    client.put("/api/users/me/password", headers={"Authorization": f"Bearer {new_token}"}, json={
        "new_password": "admin"
    })

def test_brute_force_protection():
    # 5 failed attempts
    for _ in range(5):
        response = client.post("/api/app/login", json={
            "username": "admin",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
    
    # 6th attempt should be 429 Too Many Requests
    response = client.post("/api/app/login", json={
        "username": "admin",
        "password": "wrongpassword"
    })
    assert response.status_code == 429

def test_server_editing_failure():
    admin_token = get_admin_token()
    # We can't easily test success without a mock Proxmox server, 
    # but we can test that it attempts connection.
    
    # First, let's bypass the connection check in main.py for unit tests if possible? 
    # No, let's just assert it fails as expected with invalid host.
    
    response = client.post("/api/servers", headers={"Authorization": f"Bearer {admin_token}"}, json={
        "name": "edit-test",
        "host": "invalid.local",
        "pve_username": "root@pam",
        "pve_password": "pw",
        "verify_ssl": False
    })
    assert response.status_code == 400
    assert "Failed to connect" in response.json()["detail"]
