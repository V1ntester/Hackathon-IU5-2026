from pydantic import BaseModel, ConfigDict


class Command(BaseModel):
    """Base contract for user actions; subclasses define a literal type."""

    model_config = ConfigDict(extra="forbid")
    type: str
