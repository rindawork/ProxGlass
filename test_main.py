import pytest
from fastapi.testclient import TestClient
from main import app, sessions

client = TestClient(app)

# Fixture to clear sessions before each test
@pytest.fixture(autouse=True)
def clear_sessions():
    sessions.clear()

def test_login_missing_fields():
    response = client.post("/api/login", json={"host": "1.2.3.4"})
    assert response.status_code == 422 # Validation error

def test_login_invalid_credentials():
    # Attempting to login to a non-existent host or with invalid credentials
    response = client.post("/api/login", json={
        "host": "invalid-host.local",
        "username": "root@pam",
        "password": "wrongpassword",
        "verify_ssl": False
    })
    assert response.status_code == 401
    assert "Authentication failed" in response.json()["detail"]

def test_unauthenticated_access():
    response = client.get("/api/nodes")
    assert response.status_code == 401

def test_logout_without_token():
    response = client.post("/api/logout")
    # Missing token doesn't crash, it just does nothing and completes successfully
    assert response.status_code == 200
    assert response.json() == {"message": "Logged out"}

def test_logout_with_invalid_token():
    response = client.post("/api/logout", headers={"Authorization": "Bearer invalid_token"})
    assert response.status_code == 200
    assert response.json() == {"message": "Logged out"}
