import pytest
from fastapi.testclient import TestClient
from main import app, sessions, failed_logins

client = TestClient(app)

@pytest.fixture(autouse=True)
def clear_state():
    sessions.clear()
    failed_logins.clear()

def test_login_missing_fields():
    response = client.post("/api/app/login", json={"host": "1.2.3.4"})
    assert response.status_code == 422 # Validation error

def test_login_invalid_credentials():
    response = client.post("/api/app/login", json={
        "username": "admin",
        "password": "wrongpassword"
    })
    assert response.status_code == 401
    assert "Invalid username or password" in response.json()["detail"]

def test_login_success():
    response = client.post("/api/app/login", json={
        "username": "admin",
        "password": "admin"
    })
    assert response.status_code == 200
    assert "token" in response.json()

def test_unauthenticated_access():
    response = client.get("/api/dashboard")
    assert response.status_code == 401

def test_logout_without_token():
    response = client.post("/api/app/logout")
    assert response.status_code == 200
    assert response.json() == {"message": "Logged out"}

def test_logout_with_invalid_token():
    response = client.post("/api/app/logout", headers={"Authorization": "Bearer invalid_token"})
    assert response.status_code == 200
    assert response.json() == {"message": "Logged out"}

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
    assert "Too many failed attempts" in response.json()["detail"]

def test_add_server_connection_failure():
    # To test connection failure we need authentication
    login_resp = client.post("/api/app/login", json={"username": "admin", "password": "admin"})
    token = login_resp.json()["token"]
    
    response = client.post("/api/servers", headers={"Authorization": f"Bearer {token}"}, json={
        "name": "test",
        "host": "https://invalid.local",
        "pve_username": "root@pam",
        "pve_password": "password",
        "verify_ssl": False
    })
    # The actual Proxmox request will fail
    assert response.status_code == 400
    assert "Failed to connect to Proxmox server" in response.json()["detail"]
