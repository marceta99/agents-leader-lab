"""In-process experiment scheduler: one asyncio worker per experiment plays its queued runs.

# ponytail: in-process scheduler, single replica only; move to a DB-polled worker service if Railway needs >1 replica.
"""

import asyncio
import contextlib
import logging
from datetime import UTC, datetime

from sqlalchemy import select, update

from app import runner
from app.db import SessionLocal
from app.models import Experiment, Run
from app.settings_store import get_settings

log = logging.getLogger(__name__)

GROUP_ORDER = {"none": 0, "free": 1, "directive": 2, "nondirective": 3}
DONE = ("finished", "stopped", "failed")

_workers: dict[int, asyncio.Task] = {}
_global: tuple = (None, None)  # (event loop, Semaphore): one global run cap per loop (tests use many loops)


def _global_sem(cap: int) -> asyncio.Semaphore:
    global _global
    loop = asyncio.get_running_loop()
    if _global[0] is not loop:
        # ponytail: the cap is read when the first worker of this process starts; an admin change needs a restart.
        _global = (loop, asyncio.Semaphore(cap))
    return _global[1]


async def start():
    """App startup: runs cut off by a restart -> failed; resume every unfinished experiment."""
    async with SessionLocal() as db:
        await db.execute(update(Run).where(Run.status.in_(["running", "measuring"]))
                         .values(status="failed", end_reason="server_restart", ended_at=datetime.now(UTC)))
        await db.commit()
        ids = (await db.scalars(select(Experiment.id).where(Experiment.status.in_(["queued", "running"])))).all()
    for exp_id in ids:
        launch(exp_id)


def launch(exp_id: int) -> None:
    task = _workers.get(exp_id)
    if task is None or task.done():
        _workers[exp_id] = asyncio.create_task(_worker(exp_id))


def is_active(exp_id: int) -> bool:
    task = _workers.get(exp_id)
    return task is not None and not task.done()


async def cancel(exp_id: int) -> None:
    task = _workers.pop(exp_id, None)
    if task is not None and not task.done():
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


async def shutdown() -> None:
    for exp_id in list(_workers):
        await cancel(exp_id)


async def finalize(exp_id: int) -> None:
    """All runs done (or stop requested): set the experiment's final status."""
    async with SessionLocal() as db:
        exp = await db.get(Experiment, exp_id)
        if exp is None:
            return
        if exp.stop_requested:
            await db.execute(update(Run).where(Run.experiment_id == exp_id, Run.status == "queued")
                             .values(status="stopped", end_reason="stopped"))
            exp.status = "stopped"
            exp.stop_reason = exp.stop_reason or "user_stopped"
        else:
            exp.status = "finished"
        exp.finished_at = datetime.now(UTC)
        await db.commit()


async def _stop_requested(exp_id: int) -> bool:
    async with SessionLocal() as db:
        return bool(await db.scalar(select(Experiment.stop_requested).where(Experiment.id == exp_id)))


async def _worker(exp_id: int) -> None:
    try:
        async with SessionLocal() as db:
            exp = await db.get(Experiment, exp_id)
            if exp is None:
                return
            parallel = (exp.config.get("settings") or {}).get("parallel_runs", 3)
            global_cap = (await get_settings(db))["global_run_cap"]
            runs = (await db.scalars(select(Run).where(Run.experiment_id == exp_id, Run.status == "queued"))).all()
            order = [r.id for r in sorted(runs, key=lambda r: (r.layout_no, GROUP_ORDER.get(r.group, 9), r.id))]
            if order and not exp.stop_requested:
                exp.status = "running"
                await db.commit()
        sem, gsem = asyncio.Semaphore(parallel), _global_sem(global_cap)

        async def one(run_id: int):
            async with sem, gsem:  # Semaphore wakes waiters FIFO, so runs start in `order`
                if not await _stop_requested(exp_id):
                    await runner.execute_run(run_id)

        await asyncio.gather(*(one(rid) for rid in order))
        await finalize(exp_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        log.exception("experiment %s worker failed", exp_id)
