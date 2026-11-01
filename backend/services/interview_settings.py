from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.dtos.interview_settings import InterviewTopicOption, InterviewTopicSettings
from backend.models import InterviewQuestion, InterviewSettings
from backend.services.scenarios import ScenarioService


class InterviewSettingsService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def selected(self, scenario_id: str) -> str | None:
        row = await self.session.get(InterviewSettings, scenario_id)
        return row.topic if row else None

    async def read(self, scenario_id: str) -> InterviewTopicSettings:
        await ScenarioService(self.session).require(scenario_id)
        row = await self.session.get(InterviewSettings, scenario_id)
        counts = (await self.session.execute(select(InterviewQuestion.topic, func.count().label("question_count"))
            .where(InterviewQuestion.scenario_id == scenario_id, InterviewQuestion.enabled.is_(True),
                   func.length(func.trim(InterviewQuestion.topic)) > 0)
            .group_by(InterviewQuestion.topic).order_by(InterviewQuestion.topic))).all()
        result = InterviewTopicSettings(scenario_id=scenario_id, topic=row.topic if row else None,
            version=row.version if row else 0,
            topics=[InterviewTopicOption(topic=c.topic, question_count=c.question_count) for c in counts])
        await self.session.commit()
        return result

    async def set_topic(self, scenario_id: str, topic: str | None) -> InterviewTopicSettings:
        await ScenarioService(self.session).require(scenario_id)
        if topic is not None:
            exists = await self.session.scalar(select(InterviewQuestion.id).where(
                InterviewQuestion.scenario_id == scenario_id, InterviewQuestion.topic == topic,
                InterviewQuestion.enabled.is_(True)).limit(1))
            if exists is None:
                raise HTTPException(409, "В этой теме нет активных вопросов текущего сценария")
        await self.session.execute(insert(InterviewSettings).values(scenario_id=scenario_id, topic=topic, version=1)
            .on_conflict_do_update(index_elements=[InterviewSettings.scenario_id],
                set_={"topic": topic, "version": InterviewSettings.version + 1}))
        await self.session.commit()
        return await self.read(scenario_id)
