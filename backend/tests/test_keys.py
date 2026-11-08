from fastapi import HTTPException
from sqlalchemy import select

from app.db import SessionLocal
from app.deps import get_user_api_key
from app.models import ApiKey
from app.routers import keys

KEY = "sk-ant-api03-secret-plaintext-abcd"


async def _ok(key: str) -> None:
    return None


async def test_key_roundtrip_encrypted(auth_client, monkeypatch):
    monkeypatch.setattr(keys, "check_anthropic_key", _ok)
    assert (await auth_client.get("/api/key")).status_code == 404

    r = await auth_client.put("/api/key", json={"key": f"  {KEY}\n"})
    assert r.status_code == 200
    assert r.json() == {"last4": "abcd"}

    async with SessionLocal() as db:
        row = (await db.execute(select(ApiKey))).scalar_one()
        assert row.ciphertext != KEY and KEY not in row.ciphertext
        assert await get_user_api_key(db, row.user_id) == KEY

    r = await auth_client.get("/api/key")
    assert r.json() == {"last4": "abcd"} and KEY not in r.text
    me = (await auth_client.get("/api/me")).json()
    assert me["has_key"] is True and me["key_last4"] == "abcd"

    assert (await auth_client.delete("/api/key")).status_code == 204
    assert (await auth_client.get("/api/key")).status_code == 404
    async with SessionLocal() as db:
        assert (await db.execute(select(ApiKey))).first() is None


async def test_invalid_key_400(auth_client, monkeypatch):
    async def bad(key: str) -> None:
        raise HTTPException(400, "Invalid key")

    monkeypatch.setattr(keys, "check_anthropic_key", bad)
    r = await auth_client.put("/api/key", json={"key": "sk-ant-wrong"})
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid key"
    assert (await auth_client.get("/api/key")).status_code == 404


async def test_key_requires_login(client):
    assert (await client.put("/api/key", json={"key": "x"})).status_code == 401
