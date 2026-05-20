"""A5IntegrationService unit tests."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, insert

from app.db.models import VoiceFile, VoiceSegment
from app.services.a5_integration_service import A5IntegrationService
from tests.shared.time_utils import jan1_2024_utc

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_get_track_metadata_returns_template(db_session):
    svc = A5IntegrationService(db_session)
    result = await svc.get_track_metadata(101)

    assert result["track_id"] == 101
    assert "flight_number" in result


@pytest.mark.asyncio
async def test_get_user_metadata_returns_template(db_session):
    svc = A5IntegrationService(db_session)
    result = await svc.get_user_metadata(77)

    assert result["author_id"] == 77
    assert result["username"].startswith("annotator_")


@pytest.mark.asyncio
async def test_list_audio_by_track_returns_files(db_session, seeded_a5_audio):
    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_track(9001, limit=10)

    assert result["track_id"] == 9001
    assert result["file_count"] == 1
    assert result["files"][0]["segment_count"] == 1


@pytest.mark.asyncio
async def test_list_audio_by_track_empty_returns_zero(db_session):
    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_track(9999, limit=10)

    assert result["file_count"] == 0
    assert result["files"] == []


@pytest.mark.asyncio
async def test_list_audio_by_annotator_returns_segments(db_session, seeded_a5_audio):
    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_annotator(42, limit=10)

    assert result["author_id"] == 42
    assert result["annotation_count"] == 1
    assert result["segments"][0]["file_name"] == "a5_test.mp3"


@pytest.mark.asyncio
async def test_list_audio_by_annotator_empty_returns_zero(db_session):
    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_annotator(404, limit=10)

    assert result["annotation_count"] == 0
    assert result["segments"] == []


@pytest.mark.asyncio
async def test_sync_annotations_to_a5_counts_synced(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=60,
            file_name="sync_to.mp3",
            file_path="/audio/sync_to.mp3",
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
                    "id": 61,
                    "voice_file_id": 60,
                    "relative_start": 0.0,
                    "relative_end": 1.0,
                    "abs_start_time": jan1_2024_utc(0),
                    "abs_end_time": jan1_2024_utc(0, 0, 1),
                    "annotation_text": "alpha",
                    "is_annotated": True,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 62,
                    "voice_file_id": 60,
                    "relative_start": 1.0,
                    "relative_end": 2.0,
                    "abs_start_time": jan1_2024_utc(0, 0, 1),
                    "abs_end_time": jan1_2024_utc(0, 0, 2),
                    "annotation_text": None,
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
            ]
        )
    )
    await db_session.commit()

    svc = A5IntegrationService(db_session)
    result = await svc.sync_annotations_to_a5(60)

    assert result["total_segments"] == 2
    assert result["synced_count"] == 1


@pytest.mark.asyncio
async def test_sync_annotations_to_a5_missing_file_404(db_session):
    svc = A5IntegrationService(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await svc.sync_annotations_to_a5(999)

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_sync_annotations_from_a5_updates_segments(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=70,
            file_name="sync_from.mp3",
            file_path="/audio/sync_from.mp3",
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
            id=71,
            voice_file_id=70,
            relative_start=0.0,
            relative_end=1.0,
            abs_start_time=jan1_2024_utc(0),
            abs_end_time=jan1_2024_utc(0, 0, 1),
            is_annotated=False,
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()

    svc = A5IntegrationService(db_session)
    payload = {
        "annotations": [
            {
                "segment_id": 71,
                "author_id": 501,
                "annotation_text": "alpha",
                "label_type": "clearance",
            }
        ]
    }
    result = await svc.sync_annotations_from_a5(70, payload)

    assert result["updated_count"] == 1


@pytest.mark.asyncio
async def test_sync_annotations_from_a5_missing_file_404(db_session):
    svc = A5IntegrationService(db_session)

    with pytest.raises(HTTPException) as exc_info:
        await svc.sync_annotations_from_a5(999, {"annotations": []})

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_get_cross_module_report_counts(db_session):
    start = datetime(2024, 1, 1, 0, 0, tzinfo=timezone.utc)
    end = datetime(2024, 1, 1, 3, 0, tzinfo=timezone.utc)

    await db_session.execute(delete(VoiceSegment))
    await db_session.execute(delete(VoiceFile))

    await db_session.execute(
        insert(VoiceFile).values(
            [
                {
                    "id": 80,
                    "file_name": "report_ok.mp3",
                    "file_path": "/audio/report_ok.mp3",
                    "icao_code": "VHHH",
                    "start_time_utc": start,
                    "end_time_utc": start.replace(hour=1),
                    "status": 1,
                    "a3_process_status": 2,
                    "duration_ms": 3600000,
                    "last_access_at": start,
                    "created_at": start,
                    "updated_at": start,
                },
                {
                    "id": 81,
                    "file_name": "report_fail.mp3",
                    "file_path": "/audio/report_fail.mp3",
                    "icao_code": "VHHH",
                    "start_time_utc": start.replace(hour=1),
                    "end_time_utc": start.replace(hour=2),
                    "status": 1,
                    "a3_process_status": 3,
                    "duration_ms": 3600000,
                    "last_access_at": start,
                    "created_at": start,
                    "updated_at": start,
                },
            ]
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            [
                {
                    "id": 82,
                    "voice_file_id": 80,
                    "relative_start": 0.0,
                    "relative_end": 1.0,
                    "abs_start_time": start,
                    "abs_end_time": start.replace(minute=1),
                    "is_annotated": True,
                    "created_at": start,
                    "updated_at": start,
                },
                {
                    "id": 83,
                    "voice_file_id": 81,
                    "relative_start": 0.0,
                    "relative_end": 1.0,
                    "abs_start_time": start,
                    "abs_end_time": start.replace(minute=1),
                    "is_annotated": False,
                    "created_at": start,
                    "updated_at": start,
                },
            ]
        )
    )
    await db_session.commit()

    svc = A5IntegrationService(db_session)
    result = await svc.get_cross_module_report(start, end)

    assert result["file_count"] == 2
    assert result["processed_files"] == 1
    assert result["failed_files"] == 1
    assert result["total_segments"] == 2
    assert result["annotated_segments"] == 1
