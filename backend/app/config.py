from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite+aiosqlite:///./dev.db"
    encryption_key: str = ""  # Fernet key; required when env != "dev"
    jwt_secret: str = "dev-secret-change-me-in-production-0123456789"
    env: str = "dev"  # "dev" or "prod"


settings = Settings()


def async_db_url(url: str) -> str:
    # Railway gives postgres://… or postgresql://…; SQLAlchemy async needs the asyncpg driver.
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+asyncpg://" + url[len(prefix):]
    return url
