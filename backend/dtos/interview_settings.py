from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

TopicName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class SetInterviewTopic(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topic: TopicName | None


class InterviewTopicOption(BaseModel):
    topic: str
    question_count: int


class InterviewTopicSettings(BaseModel):
    scenario_id: str
    topic: str | None
    version: int
    topics: list[InterviewTopicOption]
