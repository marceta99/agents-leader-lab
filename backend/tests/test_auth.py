import pytest
from fastapi import HTTPException

from app.deps import admin_user
from app.models import User


async def test_signup_login_logout(client):
    r = await client.post("/api/auth/signup", json={"email": "  Bob@Example.COM ", "password": "password123"})
    assert r.status_code == 200
    assert r.json()["email"] == "bob@example.com"
    assert "session" in r.cookies
    set_cookie = r.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=lax" in set_cookie

    me = await client.get("/api/me")
    assert me.status_code == 200
    assert me.json() == {"id": r.json()["id"], "email": "bob@example.com", "is_admin": False, "has_key": False, "key_last4": None}

    assert (await client.post("/api/auth/logout")).status_code == 204
    assert (await client.get("/api/me")).status_code == 401

    r = await client.post("/api/auth/login", json={"email": "bob@example.com", "password": "password123"})
    assert r.status_code == 200
    assert (await client.get("/api/me")).json()["email"] == "bob@example.com"


async def test_duplicate_email_rejected(client):
    body = {"email": "a@example.com", "password": "password123"}
    assert (await client.post("/api/auth/signup", json=body)).status_code == 200
    r = await client.post("/api/auth/signup", json={**body, "email": "A@example.com"})
    assert r.status_code == 409
    assert r.json()["detail"] == "An account with this email already exists"


async def test_wrong_password_generic_error(auth_client, client):
    wrong = await client.post("/api/auth/login", json={"email": "user@example.com", "password": "nope-nope"})
    unknown = await client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "password123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"] == "Wrong email or password"


async def test_me_requires_login(client):
    assert (await client.get("/api/me")).status_code == 401
    client.cookies.set("session", "garbage")
    assert (await client.get("/api/me")).status_code == 401


async def test_short_password_rejected(client):
    assert (await client.post("/api/auth/signup", json={"email": "a@example.com", "password": "short"})).status_code == 422
    assert (await client.post("/api/auth/signup", json={"email": "no-at-sign", "password": "password123"})).status_code == 422


async def test_admin_dep_403_for_normal_user(admin_client):
    with pytest.raises(HTTPException) as e:
        await admin_user(User(id=1, email="x@example.com", password_hash="", is_admin=False))
    assert e.value.status_code == 403
    admin = User(id=2, email="y@example.com", password_hash="", is_admin=True)
    assert await admin_user(admin) is admin
    assert (await admin_client.get("/api/me")).json()["is_admin"] is True
