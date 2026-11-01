"""Input DTOs for user commands."""

from typing import Annotated

from pydantic import Field

from backend.dtos.commands.base import Command
from backend.dtos.commands.move import MoveCommand

# Extend this type with a union when another command is introduced.
UserCommand = Annotated[MoveCommand, Field(discriminator="type")]

__all__ = ["Command", "MoveCommand", "UserCommand"]
