from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ClientPong(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["pong"]
    nonce: str = Field(min_length=36, max_length=36)


class ClientFpsReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["fps"]
    value: float = Field(ge=0, le=240, allow_inf_nan=False)
