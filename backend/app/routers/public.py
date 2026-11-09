import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Experiment, Run, RunEvent
from app.results import experiment_summary, public_setup, run_summary

router = APIRouter()


async def _run_by_token(db: AsyncSession, token: str) -> Run:
    run = await db.scalar(select(Run).where(Run.share_token == token))
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/api/public/runs/{token}")
async def public_run(token: str, db: AsyncSession = Depends(get_db)):
    run = await _run_by_token(db, token)
    exp = await db.get(Experiment, run.experiment_id) if run.experiment_id else None
    return {
        "id": run.id, "experiment_id": run.experiment_id, "experiment_name": exp.name if exp else None,
        "group": run.group, "layout_no": run.layout_no, "status": run.status, "end_reason": run.end_reason,
        "cost_usd": run.cost_usd, "result": run.result, "is_owner": False, "setup": public_setup(exp),
    }


@router.get("/api/public/demo-run")
async def demo_run(exclude: int | None = None, db: AsyncSession = Depends(get_db)):
    """A random finished and measured run from a demo experiment (not `exclude`, when there is another)."""
    rows = (await db.execute(select(Run.id, Run.result).join(Experiment, Experiment.id == Run.experiment_id)
                             .where(Experiment.is_demo.is_(True), Run.status == "finished"))).all()
    ids = [i for i, r in rows if (r or {}).get("measure_version") and not (r or {}).get("measure_error")]
    ids = [i for i in ids if i != exclude] or ids
    if not ids:
        raise HTTPException(404, "No demo run yet")
    return {"run_id": random.choice(ids)}  # ponytail: loads every demo run's result; fine for a handful of demos


@router.get("/api/public/runs/{token}/events")
async def public_run_events(token: str, db: AsyncSession = Depends(get_db)):
    run = await _run_by_token(db, token)
    events = await db.scalars(select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.seq))
    return [{"seq": e.seq, "t": e.t_ms, "type": e.type, "data": e.data} for e in events]


@router.get("/api/public/demos")
async def demos(db: AsyncSession = Depends(get_db)):
    exps = await db.scalars(
        select(Experiment).where(Experiment.is_demo.is_(True)).order_by(Experiment.created_at.desc(), Experiment.id.desc())
    )
    out = []
    for exp in exps.all():  # ponytail: one query per demo; demos are a handful
        runs = (await db.scalars(select(Run).where(Run.experiment_id == exp.id).order_by(Run.layout_no, Run.id))).all()
        out.append({"experiment": experiment_summary(exp, runs), "runs": [run_summary(r, (exp.config or {}).get("budget")) for r in runs]})
    return out
