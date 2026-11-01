from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


class ServerEvent(BaseModel):
    """Extensible server-to-client event envelope."""

    model_config = ConfigDict(extra="forbid")
    type: Literal["event"] = "event"
    name: str = Field(min_length=1, max_length=100)
    payload: dict[str, JsonValue] = Field(default_factory=dict)
