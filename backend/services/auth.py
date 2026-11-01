import asyncio
import hashlib
import hmac
import secrets

from fastapi import HTTPException
from redis.exceptions import RedisError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.models import User, PlayerStats


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return salt + ":" + digest


def verify_password(password: str, encoded: str) -> bool:
    salt, digest = encoded.split(":")
    actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return hmac.compare_digest(actual, digest)


class AuthService:
    def __init__(self, redis):
        self.redis = redis

    async def resolve(self, token: str | None) -> str:
        if not token or len(token) > 200:
            raise HTTPException(401, "Войдите в аккаунт")
        try:
            user_id = await self.redis.get("session:" + token)
        except RedisError as exc:
            raise HTTPException(503, "Хранилище сессий недоступно") from exc
        if not user_id:
            raise HTTPException(401, "Сессия истекла. Войдите снова")
        return user_id

    async def login(self, session, nickname: str, password: str):
        user = await session.scalar(select(User).where(User.nickname == nickname.lower()))
        encoded = user.password_hash if user and user.password_hash else '00000000000000000000000000000000:invalid'
        valid = await asyncio.to_thread(verify_password, password, encoded)
        if not user or not valid:
            raise HTTPException(401, "Неверный ник или пароль")
        token = secrets.token_urlsafe(32)
        try:
            await self.redis.set("session:" + token, user.id, ex=86400)
        except RedisError as exc:
            raise HTTPException(503, "Хранилище сессий недоступно") from exc
        return {"session_id": token, "user": {"id": user.id, "nickname": user.nickname, "role": user.role}}

    async def register(self, session, nickname: str, password: str):
        user = User(nickname=nickname.lower(), display_name=nickname,
                    password_hash=await asyncio.to_thread(hash_password, password), role="guest")
        session.add(user)
        try:
            await session.flush()
            session.add(PlayerStats(user_id=user.id))
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise HTTPException(409, "Этот ник уже занят") from exc
        return await self.login(session, nickname, password)

    async def logout(self, token: str):
        try:
            await self.redis.delete("session:" + token)
        except RedisError as exc:
            raise HTTPException(503, "Хранилище сессий недоступно") from exc
