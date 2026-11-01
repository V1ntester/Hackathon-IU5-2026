from pydantic import BaseModel, ConfigDict


class StatsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: str
    connections: int
    text_requests: int
    voice_requests: int
