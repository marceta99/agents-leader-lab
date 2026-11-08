from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import ApiKey, User
from app.security import SESSION_COOKIE, decode_token, decrypt


async def optional_user(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE), db: AsyncSession = Depends(get_db)
) -> User | None:
    user_id = decode_token(session) if session else None
    return await db.get(User, user_id) if user_id is not None else None


async def current_user(user: User | None = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Not logged in")
    return user


async def admin_user(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(403, "Admins only")
    return user


async def get_user_api_key(db: AsyncSession, user_id: int) -> str | None:
    row = await db.get(ApiKey, user_id)
    return decrypt(row.ciphertext) if row else None
