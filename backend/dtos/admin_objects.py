from pydantic import BaseModel, ConfigDict

from backend.models.world_object import ObjectState


class SetWorldObjectState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: ObjectState
