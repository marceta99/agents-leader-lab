from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Experiment, Run, RunEvent
from app.results import experiment_summary, run_summary

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
        "cost_usd": run.cost_usd, "result": run.result, "is_owner": False,
    }


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
        out.append({"experiment": experiment_summary(exp, runs), "runs": [run_summary(r) for r in runs]})
    return out
