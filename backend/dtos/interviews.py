from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from backend.dtos.chat import MessageText


class PracticeIdentity(BaseModel):
    player_id: UUID
    scenario_id: str = Field(default="interview", min_length=1, max_length=50)


class CreatePractice(PracticeIdentity):
    request_id: UUID


class SubmitAnswer(PracticeIdentity):
    position: int = Field(ge=1, le=4)
    request_id: UUID
    answer: MessageText


class EvaluationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    relevance: Annotated[StrictInt, Field(ge=0, le=2)]
    correctness: Annotated[StrictInt, Field(ge=0, le=2)]
    completeness: Annotated[StrictInt, Field(ge=0, le=2)]
    strength: str = Field(max_length=250)
    issue: str = Field(max_length=250)
    recommendation: str = Field(max_length=250)


class CurrentQuestion(BaseModel):
    position: int
    text: str


class InterviewState(BaseModel):
    id: str
    status: Literal["in_progress", "ready_for_evaluation", "evaluating", "completed", "evaluation_failed"]
    answered: int = Field(ge=0, le=4)
    evaluated: int = Field(ge=0, le=4)
    total: int = 4
    current_question: CurrentQuestion | None


class ReportResponse(BaseModel):
    status: str
    report_text: str | None = None


class ConversationCreated(BaseModel):
    id: str


class TurnResponse(BaseModel):
    sequence: int
    request_id: str
    message: str
    reply: str | None
    status: Literal["pending", "completed", "failed"]
