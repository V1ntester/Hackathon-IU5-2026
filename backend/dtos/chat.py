from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class ChatRequest(BaseModel):
    player_id: str = Field(min_length=36, max_length=36)
    scenario_id: str = Field(default="interview", min_length=1, max_length=50)
    message: MessageText


class ChatResponse(BaseModel):
    reply: str
