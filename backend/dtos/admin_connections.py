from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AdminConnectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: str
    display_name: str
    connected_at: datetime
    ping_ms: float | None = Field(default=None, ge=0)
    fps: float | None = None
