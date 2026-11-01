from fastapi import APIRouter

from backend.dtos import ScenarioRead
from backend.router.dependencies import Session
from backend.services.scenarios import ScenarioService

router = APIRouter(tags=["scenarios"])


@router.get("/api/scenarios", response_model=list[ScenarioRead])
async def scenarios(session: Session):
    return await ScenarioService(session).list()
