from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field, StringConstraints, model_validator

MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class ChatRequest(BaseModel):
    player_id: str = Field(min_length=36, max_length=36)
    scenario_id: str = Field(default="interview", min_length=1, max_length=50)
    message: MessageText
    conversation_id: UUID | None = None
    request_id: UUID | None = None

    @model_validator(mode="after")
    def paired_ids(self):
        if (self.conversation_id is None) != (self.request_id is None):
            raise ValueError("conversation_id и request_id передаются вместе")
        return self


class ChatResponse(BaseModel):
    reply: str
