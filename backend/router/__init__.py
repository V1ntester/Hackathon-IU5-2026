"""Domain HTTP and WebSocket routers."""

from fastapi import APIRouter
from backend.router import admin_connections, admin_interviews, admin_objects, players, practice, scenarios, sessions, interviews

router = APIRouter()
router.include_router(players.router)
router.include_router(scenarios.router)
router.include_router(practice.router)
router.include_router(sessions.router)
router.include_router(admin_objects.router)
router.include_router(admin_connections.router)
router.include_router(interviews.router)
router.include_router(admin_interviews.router)
