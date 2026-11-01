import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from backend.dtos import MoveMessage
from backend.services.practice import PracticeService
from backend.services.sessions import SessionParticipant, SessionService


class SessionTests(unittest.TestCase):
    def test_duplicate_connection_and_disconnect_identity(self):
        session = SessionService()
        participant = SessionParticipant(None, 'player', 'Guest')
        duplicate = SessionParticipant(None, 'player', 'Other')
        self.assertTrue(session.connect(participant))
        self.assertFalse(session.connect(duplicate))
        session.disconnect(duplicate)
        self.assertIs(session.participants['player'], participant)
        session.disconnect(participant)
        self.assertEqual(session.participants, {})

    def test_movement_rate_limit_and_latest_snapshot(self):
        session = SessionService()
        participant = SessionParticipant(None, 'player', 'Guest')
        session.connect(participant)
        first = MoveMessage(type='move', position={'x': 1})
        second = MoveMessage(type='move', position={'x': 2})
        with patch('backend.services.sessions.monotonic', side_effect=[1, 1.01, 1.1]):
            session.move(participant, first)
            session.move(participant, second)
            self.assertEqual(participant.position['x'], 1)
            session.move(participant, second)
        self.assertEqual(participant.snapshots.qsize(), 1)
        snapshot = participant.snapshots.get_nowait()
        self.assertEqual(snapshot['players'][0]['position']['x'], 2)
        self.assertEqual(snapshot['revision'], 3)


class PracticeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = AsyncMock()
        self.ai = AsyncMock()
        self.service = PracticeService(self.db, self.ai, SimpleNamespace(max_audio_bytes=12))
        self.service.players = AsyncMock()
        self.service.scenarios = AsyncMock()
        self.service.scenarios.require.return_value = SimpleNamespace(system_prompt='prompt')

    async def test_chat_releases_transaction_before_ai_and_counts_success(self):
        async def reply(*args):
            self.db.rollback.assert_awaited_once()
            return 'reply'
        self.ai.chat.side_effect = reply
        self.assertEqual(await self.service.chat('player', 'interview', 'hello'), 'reply')
        self.ai.chat.assert_awaited_once_with('prompt', 'hello')
        self.service.players.record_text_request.assert_awaited_once_with('player')

    async def test_ai_failure_does_not_count_text_request(self):
        self.ai.chat.side_effect = HTTPException(502, 'unavailable')
        with self.assertRaises(HTTPException):
            await self.service.chat('player', 'interview', 'hello')
        self.service.players.record_text_request.assert_not_awaited()

    async def test_invalid_audio_is_closed_without_ai_or_counter(self):
        for audio, content_type, status in [
            (b'', 'audio/wav', 422),
            (b'x' * 13, 'audio/wav', 413),
            (b'bad', 'text/plain', 415),
            (b'bad', 'audio/wav', 415),
        ]:
            with self.subTest(status=status, content_type=content_type):
                file = SimpleNamespace(read=AsyncMock(return_value=audio), close=AsyncMock(), content_type=content_type)
                with self.assertRaises(HTTPException) as error:
                    await self.service.transcribe('player', file)
                self.assertEqual(error.exception.status_code, status)
                file.close.assert_awaited_once()
        self.ai.transcribe.assert_not_awaited()
        self.service.players.record_voice_request.assert_not_awaited()

    async def test_empty_transcription_counts_success_and_closes_file(self):
        file = SimpleNamespace(read=AsyncMock(return_value=b'audio'), close=AsyncMock(), content_type='audio/webm;codecs=opus')
        self.ai.transcribe.return_value = ''
        self.assertEqual(await self.service.transcribe('player', file), '')
        self.ai.transcribe.assert_awaited_once_with(b'audio', 'audio/webm')
        self.service.players.record_voice_request.assert_awaited_once_with('player')
        file.close.assert_awaited_once()

    async def test_transcription_failure_closes_file_without_counter(self):
        file = SimpleNamespace(read=AsyncMock(return_value=b'audio'), close=AsyncMock(), content_type='audio/webm')
        self.ai.transcribe.side_effect = HTTPException(504, 'timeout')
        with self.assertRaises(HTTPException):
            await self.service.transcribe('player', file)
        self.service.players.record_voice_request.assert_not_awaited()
        file.close.assert_awaited_once()
