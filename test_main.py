import pytest
from fastapi.testclient import TestClient
from main import app, sessions

client = TestClient(app)

@pytest.fixture(autouse=True)
def clear_sessions():
    sessions.clear()

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
