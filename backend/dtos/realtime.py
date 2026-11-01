from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

Coordinate = Annotated[float, Field(ge=-10000, le=10000, allow_inf_nan=False)]


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: Coordinate = 0
    y: Coordinate = 0
    z: Coordinate = 0
