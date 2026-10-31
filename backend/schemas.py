from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
Coordinate = Annotated[float, Field(ge=-10000, le=10000, allow_inf_nan=False)]


class PlayerCreate(BaseModel):
    display_name: DisplayName = "Гость"


class PlayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    created_at: datetime


class StatsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: str
    connections: int
    text_requests: int
    voice_requests: int


class ScenarioRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    description: str


class ChatRequest(BaseModel):
    player_id: str = Field(min_length=36, max_length=36)
    scenario_id: str = Field(default="interview", min_length=1, max_length=50)
    message: MessageText


class ChatResponse(BaseModel):
    reply: str


class TranscriptionResponse(BaseModel):
    text: str


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: Coordinate = 0
    y: Coordinate = 0
    z: Coordinate = 0


class MoveMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["move"]
    position: Position
    # Поворот вокруг вертикальной оси Y сцены, в радианах.
    rotation_y: float = Field(default=0, ge=-6.283186, le=6.283186, allow_inf_nan=False)
