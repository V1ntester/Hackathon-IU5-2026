from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Form, Request, UploadFile

from backend.config import get_settings
from backend.dtos import ChatRequest, ChatResponse, TranscriptionResponse
from backend.router.dependencies import Session
from backend.services.practice import PracticeService

settings = get_settings()

router = APIRouter(tags=["practice"])


@router.post("/api/ai/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, session: Session):
    reply = await PracticeService(session, request.app.state.ai, settings).chat(
        body.player_id, body.scenario_id, body.message,
    )
    return ChatResponse(reply=reply)


@router.post("/api/ai/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    request: Request,
    session: Session,
    player_id: Annotated[UUID, Form()],
    file: Annotated[UploadFile, File()],
):
    text = await PracticeService(session, request.app.state.ai, settings).transcribe(
        str(player_id), file,
    )
    return TranscriptionResponse(text=text)
