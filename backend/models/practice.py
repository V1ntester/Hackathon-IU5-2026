from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base, utc_now


def new_id() -> str:
    return str(uuid4())


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (UniqueConstraint("player_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    player_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"))
    request_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DialogueTurn(Base):
    __tablename__ = "dialogue_turns"
    __table_args__ = (
        UniqueConstraint("conversation_id", "sequence"),
        UniqueConstraint("conversation_id", "request_id"),
        Index("uq_dialogue_pending", "conversation_id", unique=True, postgresql_where=text("status = 'pending'")),
        CheckConstraint("status IN ('pending','completed','failed')", name="ck_turn_status"),
        CheckConstraint("status != 'completed' OR (reply IS NOT NULL AND length(reply) > 0)", name="ck_turn_reply"),
        CheckConstraint("sequence > 0", name="ck_turn_sequence"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    sequence: Mapped[int] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text)
    reply: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    generation_id: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    knowledge_used: Mapped[list] = mapped_column(JSONB, default=list)


class ScenarioKnowledge(Base):
    __tablename__ = "scenario_knowledge"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    keywords: Mapped[list[str]] = mapped_column(ARRAY(Text))
    context: Mapped[str] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class InterviewQuestion(Base):
    __tablename__ = "interview_questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(100))
    difficulty: Mapped[str] = mapped_column(String(30))
    reference_answer: Mapped[str] = mapped_column(Text)
    required_points: Mapped[list[str]] = mapped_column(JSONB)
    common_errors: Mapped[list[str]] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class QuestionKnowledge(Base):
    __tablename__ = "interview_question_knowledge"
    question_id: Mapped[str] = mapped_column(ForeignKey("interview_questions.id"), primary_key=True)
    knowledge_id: Mapped[str] = mapped_column(ForeignKey("scenario_knowledge.id"), primary_key=True)


class InterviewAttempt(Base):
    __tablename__ = "interview_attempts"
    __table_args__ = (
        UniqueConstraint("player_id", "request_id"),
        CheckConstraint("status IN ('in_progress','ready_for_evaluation','evaluating','completed','evaluation_failed')", name="ck_attempt_status"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    player_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"))
    topic: Mapped[str | None] = mapped_column(String(100))
    request_id: Mapped[str] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(30), default="in_progress")
    report_text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    evaluation_id: Mapped[str | None] = mapped_column(String(36))
    evaluation_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InterviewItem(Base):
    __tablename__ = "interview_items"
    __table_args__ = (
        UniqueConstraint("attempt_id", "position"), UniqueConstraint("attempt_id", "question_id"),
        UniqueConstraint("attempt_id", "answer_request_id"),
        CheckConstraint("position BETWEEN 1 AND 4", name="ck_item_position"),
        CheckConstraint("evaluation_status IN ('pending','evaluating','completed','failed')", name="ck_item_status"),
        CheckConstraint("evaluation_status != 'completed' OR evaluation IS NOT NULL", name="ck_item_result"),
        CheckConstraint("evaluation IS NULL OR (evaluation ?& ARRAY['relevance','correctness','completeness'] AND jsonb_typeof(evaluation->'relevance') = 'number' AND (evaluation->>'relevance')::numeric IN (0,1,2) AND jsonb_typeof(evaluation->'correctness') = 'number' AND (evaluation->>'correctness')::numeric IN (0,1,2) AND jsonb_typeof(evaluation->'completeness') = 'number' AND (evaluation->>'completeness')::numeric IN (0,1,2))", name="ck_item_scores"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    attempt_id: Mapped[str] = mapped_column(ForeignKey("interview_attempts.id"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    question_id: Mapped[str] = mapped_column(ForeignKey("interview_questions.id"))
    snapshot: Mapped[dict] = mapped_column(JSONB)
    answer: Mapped[str | None] = mapped_column(Text)
    answer_request_id: Mapped[str | None] = mapped_column(String(36))
    evaluation_status: Mapped[str] = mapped_column(String(20), default="pending")
    evaluation: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    evaluator_version: Mapped[str | None] = mapped_column(String(30))
    generation_id: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)

