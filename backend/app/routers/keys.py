import anthropic
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.deps import current_user
from app.models import ApiKey, User
from app.security import encrypt

router = APIRouter()


class KeyIn(BaseModel):
    key: str


async def check_anthropic_key(key: str) -> None:
    """1-token test call. Raises HTTPException 400 (bad key) or 502 (couldn't check)."""
    try:
        async with anthropic.AsyncAnthropic(api_key=key, max_retries=0, timeout=20) as client:
            await client.messages.create(
                model="claude-haiku-5-5", max_tokens=1, messages=[{"role": "user", "content": "hi"}]
            )
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError):
        raise HTTPException(400, "Invalid key") from None
    except anthropic.APIError:
        raise HTTPException(502, "Could not reach Anthropic to check the key, try again") from None


@router.put("/api/key")
async def put_key(body: KeyIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    key = body.key.strip()
    if not key:
        raise HTTPException(400, "Invalid key")
    await check_anthropic_key(key)
    row = await db.get(ApiKey, user.id)
    if row is None:
        row = ApiKey(user_id=user.id, provider="anthropic")
        db.add(row)
    row.ciphertext, row.last4 = encrypt(key), key[-4:]
    await db.commit()
    return {"last4": row.last4}


@router.get("/api/key")
async def get_key(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(ApiKey, user.id)
    if row is None:
        raise HTTPException(404, "No key saved")
    return {"last4": row.last4}


@router.delete("/api/key", status_code=204)
async def delete_key(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    row = await db.get(ApiKey, user.id)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
