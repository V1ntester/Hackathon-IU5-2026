from typing import Annotated

from fastapi import Depends, Request, HTTPException
from backend.database import session_factory
from backend.models import User
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_session

Session = Annotated[AsyncSession, Depends(get_session)]


async def require_user(request: Request):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    user_id = await request.app.state.auth.resolve(token)
    async with session_factory() as session:
        user = await session.get(User, user_id)
        if not user:
            raise HTTPException(401, "Пользователь не найден")
        if request.url.path.startswith("/api/admin/") and user.role != "admin":
            raise HTTPException(403, "Доступ только администратору")
        player_id = request.query_params.get("player_id") or request.path_params.get("player_id")
        if request.method in ("POST", "PUT"):
            content_type = request.headers.get("content-type", "")
            if "application/json" in content_type:
                body = await request.json()
                if isinstance(body, dict):
                    player_id = body.get("player_id", player_id)
            elif "multipart/form-data" in content_type:
                form = await request.form()
                player_id = form.get("player_id", player_id)
        if player_id is not None and str(player_id) != user.id:
            raise HTTPException(403, "Нельзя действовать от имени другого игрока")
        return user
