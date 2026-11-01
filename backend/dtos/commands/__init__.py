"""Input DTOs for user commands."""

from typing import Annotated

from pydantic import Field

from backend.dtos.commands.base import Command
from backend.dtos.commands.move import MoveCommand
from backend.dtos.commands.interact import InteractCommand

UserCommand = Annotated[MoveCommand | InteractCommand, Field(discriminator="type")]

__all__ = ["Command", "MoveCommand", "InteractCommand", "UserCommand"]
