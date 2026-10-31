from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    display_name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PlayerStats(Base):
    __tablename__ = "player_stats"
    __table_args__ = (
        CheckConstraint("connections >= 0", name="ck_stats_connections"),
        CheckConstraint("text_requests >= 0", name="ck_stats_text"),
        CheckConstraint("voice_requests >= 0", name="ck_stats_voice"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    connections: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    text_requests: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    voice_requests: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)
    system_prompt: Mapped[str] = mapped_column(Text)
