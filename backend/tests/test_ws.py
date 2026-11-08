import asyncio
import json

from app.db import SessionLocal
from app.main import app
from app.models import Experiment, Run, User
from app.settings_store import DEFAULTS
from tests.test_runner import events, fast, wait_for  # noqa: F401


async def ws_messages(path: str, query: str = "", cookie: str | None = None, timeout: float = 20) -> list[dict]:
    """Minimal in-process ASGI WebSocket client (same event loop as the app, no threads)."""
    headers = [(b"host", b"test")] + ([(b"cookie", f"session={cookie}".encode())] if cookie else [])
    scope = {"type": "websocket", "asgi": {"version": "3.0"}, "scheme": "ws", "http_version": "1.1",
             "path": path, "raw_path": path.encode(), "query_string": query.encode(), "root_path": "",
             "headers": headers, "client": ("127.0.0.1", 1), "server": ("test", 80), "subprotocols": [], "state": {}}
    inbox: asyncio.Queue = asyncio.Queue()
    inbox.put_nowait({"type": "websocket.connect"})
    sent: list[dict] = []

    async def send(msg):
        sent.append(msg)

    await asyncio.wait_for(app(scope, inbox.get, send), timeout)
    return sent


def payloads(sent):
    return [json.loads(m["text"]) for m in sent if m["type"] == "websocket.send"]


async def test_ws_snapshot_then_live(client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "cell_seconds", 0.05)
    run_id = (await client.post("/api/dev/scripted-run")).json()["run_id"]

    async def some():
        return len(await events(run_id)) >= 5
    await wait_for(some)
    stored_at_connect = len(await events(run_id))
    sent = await ws_messages(f"/ws/runs/{run_id}", "after=3")
    got = payloads(sent)
    seqs = [e["seq"] for e in got]
    assert seqs == list(range(4, 4 + len(seqs)))  # no gaps, no duplicates
    assert len(got) + 3 > stored_at_connect  # live events arrived after the snapshot
    assert got[-1]["type"] == "run_ended" and sent[-1]["type"] == "websocket.close"
    assert set(got[0]) == {"seq", "t", "type", "data"}

    # a finished run: snapshot only, then close
    again = payloads(await ws_messages(f"/ws/runs/{run_id}", "after=0"))
    assert [e["seq"] for e in again] == list(range(1, len(again) + 1)) and again[-1]["type"] == "run_ended"


async def test_ws_rejects_other_users_run(auth_client):
    async with SessionLocal() as db:
        other = User(email="other@example.com", password_hash="x")
        db.add(other)
        await db.flush()
        exp = Experiment(user_id=other.id, name="theirs", config={}, status="finished")
        db.add(exp)
        await db.flush()
        run = Run(experiment_id=exp.id, group="none", layout_no=1, status="finished", result={})
        db.add(run)
        await db.commit()
        run_id = run.id
    cookie = auth_client.cookies.get("session")
    sent = await ws_messages(f"/ws/runs/{run_id}", cookie=cookie)
    assert [m["type"] for m in sent] == ["websocket.close"]
    assert (await auth_client.get(f"/api/runs/{run_id}")).status_code == 404
    assert [m["type"] for m in await ws_messages("/ws/public/nope")] == ["websocket.close"]

    async with SessionLocal() as db:  # a demo run is open to everyone
        (await db.get(Experiment, exp.id)).is_demo = True
        await db.commit()
    sent = await ws_messages(f"/ws/runs/{run_id}", cookie=cookie)
    assert [m["type"] for m in sent] == ["websocket.accept", "websocket.close"]
