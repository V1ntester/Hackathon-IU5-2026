from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Query, Request
from fastapi.responses import JSONResponse

from backend.dtos.interviews import (CreatePractice, PracticeIdentity, SubmitAnswer,
    InterviewState, ConversationCreated, TurnResponse, ReportResponse)
from backend.router.dependencies import Session
from backend.services.conversations import ConversationService
from backend.services.interviews import InterviewService
from backend.services.evaluation import EvaluationService, evaluate_attempt

router = APIRouter(tags=["conversations", "interviews"])


@router.post("/api/conversations", response_model=ConversationCreated, status_code=201)
async def create_conversation(body: CreatePractice, session: Session):
    return {"id": await ConversationService(session).create(str(body.player_id), body.scenario_id, str(body.request_id))}


@router.get("/api/conversations/{conversation_id}/turns", response_model=list[TurnResponse])
async def turns(conversation_id: UUID, player_id: UUID, session: Session,
                scenario_id: str = Query(default="interview", min_length=1, max_length=50),
                after: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=100)):
    return await ConversationService(session).turns(str(conversation_id), str(player_id), scenario_id, after, limit)


@router.post("/api/interviews", response_model=InterviewState, status_code=201)
async def create_interview(body: CreatePractice, request: Request, session: Session):
    service = InterviewService(session)
    attempt_id = await service.create(str(body.player_id), body.scenario_id, str(body.request_id), request.app.state.ai)
    return await service.state(attempt_id, str(body.player_id), body.scenario_id)


@router.get("/api/interviews/{attempt_id}", response_model=InterviewState)
async def interview(attempt_id: UUID, player_id: UUID, session: Session,
                    scenario_id: str = Query(default="interview", min_length=1, max_length=50)):
    return await InterviewService(session).state(str(attempt_id), str(player_id), scenario_id)


@router.post("/api/interviews/{attempt_id}/answers", response_model=InterviewState)
async def answer(attempt_id: UUID, body: SubmitAnswer, session: Session):
    return await InterviewService(session).answer(str(attempt_id), str(body.player_id), body.scenario_id,
        body.position, str(body.request_id), body.answer)


async def schedule(attempt_id: UUID, body: PracticeIdentity, request: Request, session: Session,
                   background: BackgroundTasks, retry: bool):
    run_id = await EvaluationService(session).start(str(attempt_id), str(body.player_id), body.scenario_id, retry)
    if run_id:
        background.add_task(evaluate_attempt, str(attempt_id), run_id, request.app.state.ai)
    return await InterviewService(session).state(str(attempt_id), str(body.player_id), body.scenario_id)


@router.post("/api/interviews/{attempt_id}/evaluate", response_model=InterviewState, status_code=202)
async def evaluate(attempt_id: UUID, body: PracticeIdentity, request: Request, session: Session, background: BackgroundTasks):
    return await schedule(attempt_id, body, request, session, background, False)


@router.post("/api/interviews/{attempt_id}/retry-evaluation", response_model=InterviewState, status_code=202)
async def retry(attempt_id: UUID, body: PracticeIdentity, request: Request, session: Session, background: BackgroundTasks):
    return await schedule(attempt_id, body, request, session, background, True)


@router.get("/api/interviews/{attempt_id}/report", response_model=ReportResponse, responses={202: {"model": ReportResponse}})
async def report(attempt_id: UUID, player_id: UUID, session: Session,
                 scenario_id: str = Query(default="interview", min_length=1, max_length=50)):
    code, body = await InterviewService(session).report(str(attempt_id), str(player_id), scenario_id)
    return JSONResponse(body, status_code=code)
