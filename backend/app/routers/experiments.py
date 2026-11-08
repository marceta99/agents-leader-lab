import math
import random

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import scheduler
from app.db import get_db
from app.deps import current_user
from app.estimate import estimate
from app.agents.prompts import LEADER_LINES
from app.game.layouts import LAYOUT_VERSION
from app.models import ApiKey, Decision, Experiment, Run, RunEvent, User
from app.pricing import PRICES
from app.settings_store import get_settings

router = APIRouter()

LEADER_GROUPS = ["directive", "nondirective"]  # with a leader; the no-leader baseline is its own experiment


MAX_LEADER_PROMPT = 1000


class ConfigIn(BaseModel):
    know_all_goals: bool = False
    budget: list = [6, 6, 6, 6]
    add_leader: bool = False
    runs: int
    model: str = "claude-haiku-5-5"
    cap_usd: float = 5.0


class ExperimentIn(ConfigIn):
    leader_prompts: dict[str, str] | None = None  # free / directive / nondirective -> text; missing = default


def experiment_name(c: ConfigIn) -> str:
    b = c.budget
    budget = f"Equal budget {b[0]}" if len(set(b)) == 1 else "Budget " + "-".join(str(v) for v in sorted(b, reverse=True))
    goals = "Goals known" if c.know_all_goals else "Goals hidden"
    return f"{goals} · {budget} · {'Directive vs non-directive leader' if c.add_leader else 'No leader'}"


def _leader_prompts(body: ExperimentIn) -> dict[str, str] | None:
    if not body.add_leader:
        return None
    given = body.leader_prompts or {}
    if set(given) - set(LEADER_GROUPS):
        raise HTTPException(422, "Leader prompts can only be set for directive and nondirective")
    out = {}
    for g in LEADER_GROUPS:
        default = LEADER_LINES[g]
        text = (given.get(g) or "").strip() or default
        if len(text) > MAX_LEADER_PROMPT:
            raise HTTPException(422, f"Each leader prompt must be at most {MAX_LEADER_PROMPT} characters")
        out[g] = text
    return out


def _validate(c: ConfigIn, s: dict) -> None:
    b = c.budget
    if len(b) != 4 or not all(isinstance(v, int) and not isinstance(v, bool) for v in b):
        raise HTTPException(422, "Budget must be 4 whole numbers")
    if any(v < 0 or v > s["budget_max_per_agent"] for v in b):
        raise HTTPException(422, f"Each budget must be between 0 and {s['budget_max_per_agent']}")
    if sum(b) < s["budget_min_total"]:
        raise HTTPException(422, f"The budgets must add up to at least {s['budget_min_total']}")
    if not 1 <= c.runs <= s["max_runs"]:
        raise HTTPException(422, f"Runs must be between 1 and {s['max_runs']}")
    if c.model not in s["models"] or c.model not in PRICES:
        raise HTTPException(422, "Unknown model")
    if not (math.isfinite(c.cap_usd) and c.cap_usd > 0):
        raise HTTPException(422, "The spending cap must be more than $0")


def _sorted_runs(runs) -> list[Run]:
    return sorted(runs, key=lambda r: (r.layout_no, scheduler.GROUP_ORDER.get(r.group, 9), r.id))


def _detail(exp: Experiment, runs) -> dict:
    from app.results import experiment_summary, run_summary

    runs = _sorted_runs(runs)
    return {**experiment_summary(exp, runs), "config": exp.config, "stop_reason": exp.stop_reason,
            "runs": [run_summary(r) for r in runs]}


async def _own(db: AsyncSession, exp_id: int, user: User) -> tuple[Experiment, list[Run]]:
    exp = await db.get(Experiment, exp_id, populate_existing=True)
    if exp is None or exp.user_id != user.id:
        raise HTTPException(404, "Experiment not found")
    runs = (await db.scalars(select(Run).where(Run.experiment_id == exp_id).execution_options(populate_existing=True))).all()
    return exp, list(runs)


@router.post("/api/experiments/estimate")
async def estimate_cost(body: ConfigIn, _: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await get_settings(db)
    _validate(body, s)
    return estimate(body.model_dump(), s)


@router.post("/api/experiments")
async def create_experiment(body: ExperimentIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    s = await get_settings(db)
    _validate(body, s)
    name = experiment_name(body)
    if await db.get(ApiKey, user.id) is None:
        raise HTTPException(400, "Add your Anthropic API key first")
    config = {**body.model_dump(), "leader_prompts": _leader_prompts(body), "name": name, "settings": s,
              "layout_version": LAYOUT_VERSION}
    exp = Experiment(user_id=user.id, name=name, config=config, status="queued", cap_usd=body.cap_usd)
    db.add(exp)
    await db.flush()
    groups = LEADER_GROUPS if body.add_leader else ["none"]
    # Each run gets its own seed: which name plays which goal, and the order agents are listed in prompts.
    runs = [Run(experiment_id=exp.id, group=g, layout_no=i, seed=random.randrange(2**31), status="queued", result={})
            for i in range(1, body.runs + 1) for g in groups]
    db.add_all(runs)
    await db.commit()
    await db.refresh(exp)  # load server-side created_at
    scheduler.launch(exp.id)
    return _detail(exp, runs)


@router.get("/api/experiments")
async def list_experiments(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    from app.results import experiment_summary

    exps = (await db.scalars(select(Experiment).where(Experiment.user_id == user.id)
                             .order_by(Experiment.created_at.desc(), Experiment.id.desc()))).all()
    runs = (await db.scalars(select(Run).join(Experiment, Run.experiment_id == Experiment.id)
                             .where(Experiment.user_id == user.id))).all()
    by_exp: dict[int, list] = {}
    for r in runs:
        by_exp.setdefault(r.experiment_id, []).append(r)
    return [experiment_summary(e, by_exp.get(e.id, [])) for e in exps]


@router.get("/api/experiments/{exp_id}")
async def get_experiment(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    return _detail(*await _own(db, exp_id, user))


@router.post("/api/experiments/{exp_id}/pause", status_code=204)
async def pause_experiment(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    """Runs already playing finish (with measurement); no new run starts until resume."""
    exp, _ = await _own(db, exp_id, user)
    if exp.status in ("queued", "running") and not exp.stop_requested:
        await db.execute(update(Experiment).where(Experiment.id == exp_id, Experiment.status.in_(("queued", "running")))
                         .values(status="paused"))
        await db.commit()
    return Response(status_code=204)


@router.post("/api/experiments/{exp_id}/resume", status_code=204)
async def resume_experiment(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    exp, _ = await _own(db, exp_id, user)
    if exp.status == "paused" and not exp.stop_requested:
        exp.status = "queued"
        await db.commit()
        scheduler.launch(exp_id)  # no-op while the old worker is still winding down: its loop picks the runs up
    return Response(status_code=204)


@router.post("/api/experiments/{exp_id}/stop", status_code=204)
async def stop_experiment(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    exp, _ = await _own(db, exp_id, user)
    if exp.status in ("queued", "running", "paused") and not exp.stop_requested:
        exp.stop_requested = True
        exp.stop_reason = exp.stop_reason or "user_stopped"
        await db.commit()
    if exp.status in ("queued", "running", "paused") and not scheduler.is_active(exp_id):
        await scheduler.finalize(exp_id)  # nothing is playing it (e.g. lost worker): settle it now
    return Response(status_code=204)


@router.delete("/api/experiments/{exp_id}", status_code=204)
async def delete_experiment(exp_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    exp, runs = await _own(db, exp_id, user)
    exp.stop_requested = True
    await db.commit()
    await scheduler.cancel(exp_id)
    ids = [r.id for r in runs]
    # Explicit child deletes: SQLite does not enforce ON DELETE CASCADE without PRAGMA foreign_keys.
    if ids:
        await db.execute(delete(RunEvent).where(RunEvent.run_id.in_(ids)))
        await db.execute(delete(Decision).where(Decision.run_id.in_(ids)))
        await db.execute(delete(Run).where(Run.id.in_(ids)))
    await db.execute(delete(Experiment).where(Experiment.id == exp_id))
    await db.commit()
    return Response(status_code=204)
