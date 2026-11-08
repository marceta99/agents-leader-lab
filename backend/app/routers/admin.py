from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import admin_user
from app.models import Experiment, User
from app.pricing import PRICES
from app.settings_store import DEFAULTS, get_settings, put_settings

router = APIRouter()


def _validate(s: dict) -> None:
    for k, default in DEFAULTS.items():
        v = s[k]
        if isinstance(default, (int, float)):
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v <= 0:
                raise HTTPException(422, f"{k} must be a positive number")
    models = s["models"]
    if not isinstance(models, list) or not models or not all(isinstance(m, str) and m in PRICES for m in models):
        raise HTTPException(422, f"models must be a non-empty list of: {', '.join(PRICES)}")
    if s["effort"] not in ("low", "medium", "high"):
        raise HTTPException(422, "effort must be low, medium or high")


@router.get("/api/admin/settings")
async def read_settings(_: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    return await get_settings(db)


@router.put("/api/admin/settings")
async def write_settings(data: dict = Body(...), _: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    merged = {**await get_settings(db), **{k: v for k, v in data.items() if k in DEFAULTS}}  # partial PUT keeps the rest
    _validate(merged)
    return await put_settings(db, merged)


class DemoIn(BaseModel):
    is_demo: bool


@router.post("/api/admin/experiments/{exp_id}/demo", status_code=204)
async def set_demo(exp_id: int, body: DemoIn, user: User = Depends(admin_user), db: AsyncSession = Depends(get_db)):
    exp = await db.get(Experiment, exp_id)
    if exp is None or exp.user_id != user.id:
        raise HTTPException(404, "Experiment not found")
    exp.is_demo = body.is_demo
    await db.commit()
