from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base


class InterviewSettings(Base):
    __tablename__ = "interview_settings"

    scenario_id: Mapped[str] = mapped_column(String(50), ForeignKey("scenarios.id"), primary_key=True)
    topic: Mapped[str | None] = mapped_column(String(100))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
