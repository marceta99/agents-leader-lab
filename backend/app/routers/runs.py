import contextlib

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import hub
from app.config import settings
from app.db import SessionLocal, get_db
from app.deps import optional_user
from app.models import Experiment, Run, RunEvent, User
from app.results import public_setup
from app.security import SESSION_COOKIE, decode_token

router = APIRouter()

DONE = ("finished", "stopped", "failed")


def _wire(e: RunEvent) -> dict:
    return {"seq": e.seq, "t": e.t_ms, "type": e.type, "data": e.data}


async def _access(db: AsyncSession, run_id: int, user_id: int | None) -> tuple[Run, Experiment | None, bool]:
    """(run, experiment, is_owner). 404 unless owner, demo experiment, or a dev run (experiment null) in dev."""
    run = await db.get(Run, run_id)
    exp = await db.get(Experiment, run.experiment_id) if run and run.experiment_id else None
    is_owner = exp is not None and user_id is not None and exp.user_id == user_id
    if run is None or not (is_owner or (exp and exp.is_demo) or (run.experiment_id is None and settings.env == "dev")):
        raise HTTPException(404, "Run not found")
    return run, exp, is_owner


@router.get("/api/runs/{run_id}")
async def get_run(run_id: int, user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    run, exp, is_owner = await _access(db, run_id, user.id if user else None)
    return {
        "id": run.id, "experiment_id": run.experiment_id, "experiment_name": exp.name if exp else None,
        "group": run.group, "layout_no": run.layout_no, "status": run.status, "end_reason": run.end_reason,
        "cost_usd": run.cost_usd, "result": run.result, "share_token": run.share_token if is_owner else None,
        "is_owner": is_owner, "setup": public_setup(exp),
    }


@router.get("/api/runs/{run_id}/events")
async def get_run_events(run_id: int, user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    await _access(db, run_id, user.id if user else None)
    rows = await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq))
    return [_wire(e) for e in rows]


async def _stream(ws: WebSocket, run_id: int, after: int) -> None:
    """Subscribe first, then send stored events > after, then live ones (deduped by seq). Close after run_ended.

    # ponytail: a client that disconnects mid-run is only noticed on the next send; add a receive watcher if
    # idle sockets on long runs ever matter.
    """
    q = hub.subscribe(run_id)
    try:
        await ws.accept()
        last = after
        async with SessionLocal() as db:
            status = await db.scalar(select(Run.status).where(Run.id == run_id))  # read before the events
            rows = (await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id, RunEvent.seq > after)
                                     .order_by(RunEvent.seq))).all()
        for e in rows:
            await ws.send_json(_wire(e))
            last = e.seq
            if e.type == "run_ended":
                return
        if status in DONE:
            return
        while True:
            e = await q.get()
            if e is None:  # run task is gone (failed or finished without more events)
                return
            if e["seq"] <= last:
                continue
            await ws.send_json(e)
            last = e["seq"]
            if e["type"] == "run_ended":
                return
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(run_id, q)
        with contextlib.suppress(Exception):  # the client may already be gone
            await ws.close()


@router.websocket("/ws/runs/{run_id}")
async def ws_run(ws: WebSocket, run_id: int, after: int = 0):
    token = ws.cookies.get(SESSION_COOKIE)
    user_id = decode_token(token) if token else None
    async with SessionLocal() as db:
        try:
            await _access(db, run_id, user_id)
        except HTTPException:
            await ws.close(code=1008)
            return
    await _stream(ws, run_id, after)


@router.websocket("/ws/public/{token}")
async def ws_public(ws: WebSocket, token: str, after: int = 0):
    async with SessionLocal() as db:
        run_id = await db.scalar(select(Run.id).where(Run.share_token == token))
    if run_id is None:
        await ws.close(code=1008)
        return
    await _stream(ws, run_id, after)
