from typing import Literal

from pydantic import BaseModel, Field


class Credentials(BaseModel):
    nickname: str = Field(min_length=1, max_length=40, pattern=r"^[a-zA-Z0-9_а-яА-ЯёЁ-]+$")
    password: str = Field(min_length=1, max_length=128)


class AccountRead(BaseModel):
    id: str
    nickname: str
    role: Literal["guest", "admin"]


class AuthResponse(BaseModel):
    session_id: str
    user: AccountRead
