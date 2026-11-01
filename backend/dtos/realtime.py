from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Coordinate = Annotated[float, Field(ge=-10000, le=10000, allow_inf_nan=False)]


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
