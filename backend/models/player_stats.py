from sqlalchemy import CheckConstraint, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base


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
