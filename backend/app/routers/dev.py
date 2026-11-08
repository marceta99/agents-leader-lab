import asyncio
import random

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import runner
from app.config import settings
from app.db import get_db
from app.models import Run

router = APIRouter()

_tasks: set[asyncio.Task] = set()  # keep references so running dev runs are not garbage-collected


@router.post("/api/dev/scripted-run")
async def scripted_run(db: AsyncSession = Depends(get_db)):
    if settings.env != "dev":
        raise HTTPException(404, "Not found")
    run = Run(experiment_id=None, group="none", layout_no=random.randint(1, 50),
              seed=random.randrange(2**31), status="queued", result={})
    db.add(run)
    await db.commit()
    task = asyncio.create_task(runner.execute_run(run.id, mode="scripted"))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"run_id": run.id}
