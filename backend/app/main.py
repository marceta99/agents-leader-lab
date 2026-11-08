from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import scheduler
from app.config import settings
from app.db import create_all
from app.routers import admin, auth, dev, experiments, keys, public, results, runs


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.env == "dev":
        await create_all()  # prod uses Alembic migrations
    await scheduler.start()  # recover interrupted runs, resume unfinished experiments
    yield
    await scheduler.shutdown()


app = FastAPI(title="Agents Leader Lab", lifespan=lifespan)


@app.get("/api/health")
async def health():
    return {"ok": True}


# Every router declares full paths (/api/... or /ws/...), so no prefixes here.
for r in (auth, keys, experiments, runs, results, public, admin, dev):
    app.include_router(r.router)
