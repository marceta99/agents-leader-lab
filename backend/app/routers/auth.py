from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.deps import current_user
from app.models import ApiKey, User
from app.security import SESSION_COOKIE, SESSION_DAYS, create_token, hash_password, verify_password

router = APIRouter()


class Credentials(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or len(v) > 320:
            raise ValueError("Enter a valid email")
        return v


class Signup(Credentials):
    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


def _user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "is_admin": u.is_admin}


def _set_cookie(resp: Response, user_id: int) -> None:
    resp.set_cookie(
        SESSION_COOKIE,
        create_token(user_id),
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.env != "dev",
        path="/",
    )


@router.post("/api/auth/signup")
async def signup(body: Signup, resp: Response, db: AsyncSession = Depends(get_db)):
    user = User(email=body.email, password_hash=hash_password(body.password), is_admin=False)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        raise HTTPException(409, "An account with this email already exists")
    _set_cookie(resp, user.id)
    return _user_out(user)


@router.post("/api/auth/login")
async def login(body: Credentials, resp: Response, db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(User).where(User.email == body.email))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    _set_cookie(resp, user.id)
    return _user_out(user)


@router.post("/api/auth/logout", status_code=204)
async def logout(resp: Response):
    resp.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax", secure=settings.env != "dev")


@router.get("/api/me")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    key = await db.get(ApiKey, user.id)
    return {**_user_out(user), "has_key": key is not None, "key_last4": key.last4 if key else None}
