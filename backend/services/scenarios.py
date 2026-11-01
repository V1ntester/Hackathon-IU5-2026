from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models import Scenario


class ScenarioService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def list(self) -> list[Scenario]:
        return list((await self.session.scalars(select(Scenario).order_by(Scenario.id))).all())

    async def require(self, scenario_id: str) -> Scenario:
        scenario = await self.session.get(Scenario, scenario_id)
        if scenario is None:
            raise HTTPException(404, "Сценарий не найден")
        return scenario
