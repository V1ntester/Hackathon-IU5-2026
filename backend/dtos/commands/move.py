from typing import Literal

from pydantic import Field

from backend.dtos.commands.base import Command
from backend.dtos.realtime import Position


class MoveCommand(Command):
    type: Literal["move"]
    position: Position
    # Поворот вокруг вертикальной оси Y сцены, в радианах.
    rotation_y: float = Field(default=0, ge=-6.283186, le=6.283186, allow_inf_nan=False)
