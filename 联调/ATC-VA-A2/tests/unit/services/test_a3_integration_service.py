"""A3IntegrationService unit tests."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert

from app.db.models import VoiceFile, VoiceSegment
from app.services.a3_integration_service import A3IntegrationService
from tests.shared.time_utils import jan1_2024_utc

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_request_processing_sets_processing_status(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=1,
            file_name="req.mp3",
            file_path="/audio/req.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=0,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.request_processing(1)

    assert result["status"] == 1
    assert result["voice_file_id"] == 1
    assert result["file_name"] == "req.mp3"


@pytest.mark.asyncio
async def test_request_processing_returns_existing_status(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=2,
            file_name="done.mp3",
            file_path="/audio/done.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=2,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.request_processing(2)

    assert result["status"] == 2
    assert "already" in result["message"].lower()


@pytest.mark.asyncio
async def test_request_processing_missing_file_404(db_session):
    svc = A3IntegrationService(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await svc.request_processing(999)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_get_processing_status_counts_segments(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=3,
            file_name="status.mp3",
            file_path="/audio/status.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=1,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            [
                {
                    "id": 100,
                    "voice_file_id": 3,
                    "relative_start": 0.0,
                    "relative_end": 1.0,
                    "abs_start_time": jan1_2024_utc(0),
                    "abs_end_time": jan1_2024_utc(0, 0, 1),
                    "is_annotated": True,
                    "asr_content": "alpha",
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 101,
                    "voice_file_id": 3,
                    "relative_start": 1.0,
                    "relative_end": 2.0,
                    "abs_start_time": jan1_2024_utc(0, 0, 1),
                    "abs_end_time": jan1_2024_utc(0, 0, 2),
                    "is_annotated": False,
                    "asr_content": None,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
            ]
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.get_processing_status(3)

    assert result["segment_count"] == 2
    assert result["annotated_count"] == 1
    assert result["status_text"] == "processing"


@pytest.mark.asyncio
async def test_retry_processing_applies_backoff_and_resets_error(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=4,
            file_name="retry.mp3",
            file_path="/audio/retry.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=3,
            error_log="boom",
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)

    with patch("app.services.a3_integration_service.asyncio.sleep", new=AsyncMock()) as mocked_sleep, patch(
        "app.services.a3_integration_service.uniform", return_value=0.0
    ):
        result = await svc.retry_processing(4, attempt=1)

    assert result["attempt"] == 2
    assert result["status"] == 1
    mocked_sleep.assert_awaited_once()


@pytest.mark.asyncio
async def test_retry_processing_rejects_too_many_attempts(db_session):
    svc = A3IntegrationService(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await svc.retry_processing(1, attempt=99)

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_sync_annotation_status_counts_ready_segments(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=5,
            file_name="sync.mp3",
            file_path="/audio/sync.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=2,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            [
                {
                    "id": 200,
                    "voice_file_id": 5,
                    "relative_start": 0.0,
                    "relative_end": 1.0,
                    "abs_start_time": jan1_2024_utc(0),
                    "abs_end_time": jan1_2024_utc(0, 0, 1),
                    "asr_content": "alpha",
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 201,
                    "voice_file_id": 5,
                    "relative_start": 1.0,
                    "relative_end": 2.0,
                    "abs_start_time": jan1_2024_utc(0, 0, 1),
                    "abs_end_time": jan1_2024_utc(0, 0, 2),
                    "asr_content": None,
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 202,
                    "voice_file_id": 5,
                    "relative_start": 2.0,
                    "relative_end": 3.0,
                    "abs_start_time": jan1_2024_utc(0, 0, 2),
                    "abs_end_time": jan1_2024_utc(0, 0, 3),
                    "asr_content": "bravo",
                    "is_annotated": True,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
            ]
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.sync_annotation_status(5)

    assert result["ready_for_annotation"] == 1
    assert result["already_annotated"] == 1
    assert result["pending_asr"] == 1


@pytest.mark.asyncio
async def test_list_processing_queue_filters_and_orders(db_session):
    await db_session.execute(delete(VoiceSegment))
    await db_session.execute(delete(VoiceFile))
    now = datetime(2024, 1, 1, 12, 0, tzinfo=timezone.utc)
    await db_session.execute(
        insert(VoiceFile).values(
            [
                {
                    "id": 11,
                    "file_name": "queue1.mp3",
                    "file_path": "/audio/queue1.mp3",
                    "icao_code": "VHHH",
                    "start_time_utc": jan1_2024_utc(0),
                    "end_time_utc": jan1_2024_utc(1),
                    "status": 1,
                    "a3_process_status": 0,
                    "duration_ms": 3600000,
                    "last_access_at": jan1_2024_utc(0),
                    "created_at": now,
                    "updated_at": now,
                },
                {
                    "id": 12,
                    "file_name": "queue2.mp3",
                    "file_path": "/audio/queue2.mp3",
                    "icao_code": "VHHH",
                    "start_time_utc": jan1_2024_utc(1),
                    "end_time_utc": jan1_2024_utc(2),
                    "status": 1,
                    "a3_process_status": 1,
                    "duration_ms": 3600000,
                    "last_access_at": jan1_2024_utc(1),
                    "created_at": now.replace(hour=13),
                    "updated_at": now.replace(hour=13),
                },
            ]
        )
    )
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.list_processing_queue(status_filter=1, limit=10)

    assert result["queue_size"] == 1
    assert result["items"][0]["voice_file_id"] == 12
