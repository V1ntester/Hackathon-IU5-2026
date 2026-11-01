from fastapi import APIRouter, Request
from backend.dtos.auth import Credentials, AuthResponse, AccountRead
from backend.router.dependencies import Session

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=AuthResponse)
async def login(body: Credentials, request: Request, session: Session):
    return await request.app.state.auth.login(session, body.nickname, body.password)


@router.post("/register", status_code=201, response_model=AuthResponse)
async def register(body: Credentials, request: Request, session: Session):
    return await request.app.state.auth.register(session, body.nickname, body.password)


@router.post("/logout")
async def logout(request: Request):
    from backend.router.dependencies import require_user
    user = await require_user(request)
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    await request.app.state.auth.logout(token)
    peer = request.app.state.game_session.participants.get(user.id)
    if peer and getattr(peer, "session_id", None) == token:
        await peer.websocket.close(code=1008, reason="Вы вышли из аккаунта")
    return {"ok": True}


@router.get("/me", response_model=AccountRead)
async def me(request: Request):
    from backend.router.dependencies import require_user
    user = await require_user(request)
    return {"id": user.id, "nickname": user.nickname, "role": user.role}
