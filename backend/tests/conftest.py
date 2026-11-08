import os
import tempfile

# Unique SQLite file per test process, so parallel pytest runs never share a DB. Must run before app imports.
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{tempfile.gettempdir()}/all-test-{os.getpid()}.db".replace("\\", "/")
os.environ["ENV"] = "dev"

import httpx  # noqa: E402
import pytest  # noqa: E402

from app.db import Base, engine  # noqa: E402
import app.models  # noqa: E402,F401
from app.main import app  # noqa: E402


@pytest.fixture
async def db_setup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield


@pytest.fixture
async def client(db_setup):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _sign_up(c: httpx.AsyncClient, email: str) -> None:
    r = await c.post("/api/auth/signup", json={"email": email, "password": "password123"})
    assert r.status_code == 200, r.text


@pytest.fixture
async def auth_client(db_setup):
    """Own client (own cookie jar), signed up and logged in as user@example.com / password123."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        await _sign_up(c, "user@example.com")
        yield c


@pytest.fixture
async def admin_client(db_setup):
    """Own client, logged in as admin@example.com with is_admin=True set directly in the DB."""
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import User

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        await _sign_up(c, "admin@example.com")
        async with SessionLocal() as db:
            await db.execute(update(User).where(User.email == "admin@example.com").values(is_admin=True))
            await db.commit()
        yield c
