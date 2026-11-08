import json
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import results
from app.db import get_db
from app.deps import current_user
from app.models import Decision, Experiment, Run, RunEvent, User

router = APIRouter()


async def _own_experiment(db: AsyncSession, exp_id: int, user: User) -> tuple[Experiment, list[Run]]:
    exp = await db.get(Experiment, exp_id)
    if exp is None or exp.user_id != user.id:
        raise HTTPException(404, "Experiment not found")
    runs = (await db.scalars(select(Run).where(Run.experiment_id == exp_id).order_by(Run.layout_no, Run.id))).all()
    return exp, list(runs)


async def _own_run(db: AsyncSession, run_id: int, user: User) -> Run:
    run = await db.get(Run, run_id)
    exp = await db.get(Experiment, run.experiment_id) if run and run.experiment_id else None
    if exp is None or exp.user_id != user.id:
        raise HTTPException(404, "Run not found")
    return run


async def _by_run(db: AsyncSession, model, runs: list[Run], order) -> dict:
    out: dict = {}
    rows = await db.scalars(select(model).where(model.run_id.in_([r.id for r in runs])).order_by(model.run_id, order))
    for row in rows:
        out.setdefault(row.run_id, []).append(row)
    return out


@router.get("/api/experiments/{exp_id}/results")
async def experiment_results(
    exp_id: int,
    richest: Literal["any", "leader_is_richest", "leader_not_richest"] = "any",
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    _, runs = await _own_experiment(db, exp_id, user)
    return results.aggregate(runs, richest)


async def _export_data(db: AsyncSession, exp_id: int, user: User):
    exp, runs = await _own_experiment(db, exp_id, user)
    return exp, runs, await _by_run(db, RunEvent, runs, RunEvent.seq), await _by_run(db, Decision, runs, Decision.id)


@router.get("/api/experiments/{exp_id}/export.json")
async def export_json(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    data = results.export_json(*await _export_data(db, exp_id, user))
    return Response(
        json.dumps(data, default=str), media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="experiment-{exp_id}.json"'},
    )


@router.get("/api/experiments/{exp_id}/export.zip")
async def export_zip(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return Response(
        results.export_zip(*await _export_data(db, exp_id, user)), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="experiment-{exp_id}.zip"'},
    )


@router.post("/api/runs/{run_id}/share")
async def share_run(run_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    run = await _own_run(db, run_id, user)
    if not run.share_token:
        run.share_token = secrets.token_urlsafe(16)
        await db.commit()
    return {"token": run.share_token}


@router.delete("/api/runs/{run_id}/share", status_code=204)
async def unshare_run(run_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    run = await _own_run(db, run_id, user)
    run.share_token = None
    await db.commit()
