from pydantic import BaseModel, ConfigDict

from backend.models.world_object import ObjectState


class WorldObjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    state: ObjectState
