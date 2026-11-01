from fastapi import APIRouter, HTTPException, Request

from backend.dtos.admin_objects import SetWorldObjectState
from backend.dtos.world_object import WorldObjectRead
from backend.services.sessions import ObjectNotFoundError, SessionService

router = APIRouter(prefix="/api/admin/objects", tags=["admin objects"])


def get_session_service(request: Request) -> SessionService:
    return request.app.state.game_session


@router.get("", response_model=list[WorldObjectRead])
async def list_world_objects(request: Request):
    game_session = get_session_service(request)
    return list(game_session.objects.values())


@router.put("/{object_id}", response_model=WorldObjectRead)
async def set_world_object_state(object_id: str, body: SetWorldObjectState, request: Request):
    game_session = get_session_service(request)
    try:
        obj = game_session.set_object_state(object_id, body.state)
    except ObjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Объект мира не найден") from exc
    return obj
