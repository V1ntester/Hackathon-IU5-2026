"""Domain HTTP and WebSocket routers."""

from fastapi import APIRouter, Depends
from backend.router import auth
from backend.router.dependencies import require_user
from backend.router import admin_connections, admin_interviews, admin_objects, players, practice, scenarios, sessions, interviews

router = APIRouter()
router.include_router(players.router, dependencies=[Depends(require_user)])
router.include_router(scenarios.router, dependencies=[Depends(require_user)])
router.include_router(practice.router, dependencies=[Depends(require_user)])
router.include_router(sessions.router)
router.include_router(admin_objects.router, dependencies=[Depends(require_user)])
router.include_router(admin_connections.router, dependencies=[Depends(require_user)])
router.include_router(interviews.router, dependencies=[Depends(require_user)])
router.include_router(admin_interviews.router, dependencies=[Depends(require_user)])

router.include_router(auth.router)
