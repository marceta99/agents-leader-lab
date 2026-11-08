from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

JSONType = JSON().with_variant(JSONB(), "postgresql")


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ApiKey(Base):
    __tablename__ = "api_keys"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), default="anthropic")
    ciphertext: Mapped[str] = mapped_column(Text)
    last4: Mapped[str] = mapped_column(String(4))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class GlobalSettings(Base):
    __tablename__ = "global_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # always 1
    data: Mapped[dict] = mapped_column(JSONType, default=dict)


class Experiment(Base):
    __tablename__ = "experiments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[dict] = mapped_column(JSONType)  # user settings + {"settings": global snapshot, "layout_version": 1}
    # queued | running | finished | stopped | failed
    status: Mapped[str] = mapped_column(String(16), default="queued")
    stop_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    stop_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    spent_usd: Mapped[float] = mapped_column(Float, default=0.0)
    cap_usd: Mapped[float] = mapped_column(Float, default=5.0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_id: Mapped[int | None] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), index=True, nullable=True  # null = dev scripted run
    )
    group: Mapped[str] = mapped_column(String(16))  # none | free | directive | nondirective | solo
    layout_no: Mapped[int] = mapped_column(Integer)
    # queued | running | measuring | finished | stopped | failed
    status: Mapped[str] = mapped_column(String(16), default="queued")
    end_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    result: Mapped[dict] = mapped_column(JSONType, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RunEvent(Base):
    __tablename__ = "run_events"
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True)
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    t_ms: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(32))
    data: Mapped[dict] = mapped_column(JSONType)


class Decision(Base):
    __tablename__ = "decisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    agent: Mapped[str] = mapped_column(String(16))
    seq: Mapped[int] = mapped_column(Integer)  # this agent's decision number, 1-based
    t_ms: Mapped[int] = mapped_column(Integer)
    trigger: Mapped[list] = mapped_column(JSONType)  # list of trigger sentences
    request: Mapped[dict] = mapped_column(JSONType)  # exact system + messages sent (see docs/contracts.md)
    response: Mapped[dict] = mapped_column(JSONType)  # parsed decision or error text
    action: Mapped[dict | None] = mapped_column(JSONType, nullable=True)  # {"kind","chair","cell"} as applied
    outcome: Mapped[str] = mapped_column(String(16))  # ok | invalid | skipped_invalid | ignored_busy
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
