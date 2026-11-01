from pydantic import BaseModel, ConfigDict


class ScenarioRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    description: str
