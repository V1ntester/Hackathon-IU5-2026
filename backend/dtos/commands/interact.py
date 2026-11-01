from typing import Annotated, Literal

from pydantic import StringConstraints

from backend.dtos.commands.base import Command

ObjectId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class InteractCommand(Command):
    """A player's request to interact with a scene object."""

    type: Literal["interact"]
    object_id: ObjectId
