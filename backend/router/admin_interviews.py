from fastapi import APIRouter, Query

from backend.dtos.interview_settings import InterviewTopicSettings, SetInterviewTopic
from backend.router.dependencies import Session
from backend.services.interview_settings import InterviewSettingsService

router = APIRouter(prefix="/api/admin/interviews", tags=["admin interviews"])


@router.get("/settings", response_model=InterviewTopicSettings)
async def settings(session: Session, scenario_id: str = Query(default="interview", min_length=1, max_length=50)):
    return await InterviewSettingsService(session).read(scenario_id)


@router.put("/settings", response_model=InterviewTopicSettings)
async def set_topic(body: SetInterviewTopic, session: Session,
                    scenario_id: str = Query(default="interview", min_length=1, max_length=50)):
    return await InterviewSettingsService(session).set_topic(scenario_id, body.topic)
