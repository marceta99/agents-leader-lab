from sqlalchemy.ext.asyncio import AsyncSession

from app.models import GlobalSettings

# Global settings adjustable by admins. New experiments snapshot these into experiment.config["settings"].
DEFAULTS: dict = {
    "cell_seconds": 2.0,
    "flip_seconds": 2.0,
    "time_limit_s": 600,
    "call_limit": 60,
    "heartbeat_s": 10,
    "min_call_gap_s": 3,
    "budget_max_per_agent": 12,
    "budget_min_total": 16,
    "max_runs": 25,
    "parallel_runs": 1,  # product allows up to 3; 1 by default because typical keys hit tokens-per-minute limits
    "global_run_cap": 30,
    "models": ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    "effort": "low",
    "min_influence": 0.5,
}


async def get_settings(db: AsyncSession) -> dict:
    row = await db.get(GlobalSettings, 1)
    return {**DEFAULTS, **(row.data if row else {})}


async def put_settings(db: AsyncSession, data: dict) -> dict:
    merged = {**DEFAULTS, **{k: v for k, v in data.items() if k in DEFAULTS}}
    row = await db.get(GlobalSettings, 1)
    if row:
        row.data = merged
    else:
        db.add(GlobalSettings(id=1, data=merged))
    await db.commit()
    return merged
