from dataclasses import dataclass, replace
from enum import StrEnum


class ObjectState(StrEnum):
    INACTIVE = "inactive"
    ACTIVE = "active"


@dataclass(frozen=True)
class WorldObject:
    """An object owned by a running session, without database persistence."""

    id: str
    state: ObjectState = ObjectState.INACTIVE

    def interact(self) -> "WorldObject":
        state = ObjectState.ACTIVE if self.state == ObjectState.INACTIVE else ObjectState.INACTIVE
        return replace(self, state=state)
