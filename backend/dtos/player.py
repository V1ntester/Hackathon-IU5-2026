from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class PlayerCreate(BaseModel):
    display_name: DisplayName = "Гость"


class PlayerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    created_at: datetime
