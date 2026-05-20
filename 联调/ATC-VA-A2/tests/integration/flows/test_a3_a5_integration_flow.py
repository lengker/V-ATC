"""
A-3 and A-5 integration flow tests.

These tests exercise real AsyncSession-backed persistence and service behavior,
so they belong in integration/flows instead of top-level test collection.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VoiceFile, VoiceSegment
from app.services.a3_integration_service import A3IntegrationService
from app.services.a5_integration_service import A5IntegrationService

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_a3_request_processing(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    voice_file = VoiceFile(
        file_name="test_vhhh_20260428T120000Z.mp3",
        file_path="/data/audio/test.mp3",
        icao_code="VHHH",
        start_time_utc=now,
        end_time_utc=now + timedelta(seconds=1800),
        file_size=1024000,
        source_url="https://liveatc.net/test",
        status=1,
        a3_process_status=0,
        duration_ms=1800000,
    )
    db_session.add(voice_file)
    await db_session.commit()
    await db_session.refresh(voice_file)

    svc = A3IntegrationService(db_session)
    result = await svc.request_processing(voice_file.id)

    assert result["voice_file_id"] == voice_file.id
    assert result["status"] == 1
    assert "A-3" in result["message"]
    assert "Processing request sent" in result["message"]

    await db_session.refresh(voice_file)
    assert voice_file.a3_process_status == 1


@pytest.mark.asyncio
async def test_a3_get_processing_status(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    voice_file = VoiceFile(
        file_name="test_status.mp3",
        file_path="/data/audio/status.mp3",
        icao_code="VHHH",
        start_time_utc=now,
        end_time_utc=now + timedelta(seconds=1800),
        file_size=512000,
        a3_process_status=2,
        duration_ms=1800000,
    )
    db_session.add(voice_file)
    await db_session.commit()
    await db_session.refresh(voice_file)

    for i in range(3):
        segment = VoiceSegment(
            voice_file_id=voice_file.id,
            relative_start=float(i * 10),
            relative_end=float((i + 1) * 10),
            abs_start_time=now + timedelta(seconds=i * 10),
            abs_end_time=now + timedelta(seconds=(i + 1) * 10),
            asr_content=f"Test ASR content {i}",
            is_annotated=(i == 0),
        )
        db_session.add(segment)
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.get_processing_status(voice_file.id)

    assert result["voice_file_id"] == voice_file.id
    assert result["status_text"] == "completed"
    assert result["segment_count"] == 3
    assert result["annotated_count"] == 1


@pytest.mark.asyncio
async def test_a3_retry_processing(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    voice_file = VoiceFile(
        file_name="test_retry.mp3",
        file_path="/data/audio/retry.mp3",
        icao_code="VHHH",
        start_time_utc=now,
        end_time_utc=now + timedelta(seconds=1800),
        a3_process_status=3,
        error_log="Previous processing failed",
        duration_ms=1800000,
    )
    db_session.add(voice_file)
    await db_session.commit()
    await db_session.refresh(voice_file)

    svc = A3IntegrationService(db_session)
    result = await svc.retry_processing(voice_file.id, attempt=0)

    assert result["voice_file_id"] == voice_file.id
    assert result["attempt"] == 1
    assert result["delay_seconds"] >= 2
    assert result["status"] == 1

    await db_session.refresh(voice_file)
    assert voice_file.a3_process_status == 1
    assert voice_file.error_log is None


@pytest.mark.asyncio
async def test_a3_sync_annotation_status(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    voice_file = VoiceFile(
        file_name="test_anno_sync.mp3",
        file_path="/data/audio/anno_sync.mp3",
        icao_code="VHHH",
        start_time_utc=now,
        end_time_utc=now + timedelta(seconds=1800),
        a3_process_status=2,
        duration_ms=1800000,
    )
    db_session.add(voice_file)
    await db_session.commit()
    await db_session.refresh(voice_file)

    segments_data = [
        (0, 10, "ASR text 1", True),
        (10, 20, "ASR text 2", False),
        (20, 30, None, False),
    ]

    for start, end, asr, annotated in segments_data:
        segment = VoiceSegment(
            voice_file_id=voice_file.id,
            relative_start=float(start),
            relative_end=float(end),
            abs_start_time=now + timedelta(seconds=start),
            abs_end_time=now + timedelta(seconds=end),
            asr_content=asr,
            is_annotated=annotated,
        )
        db_session.add(segment)
    await db_session.commit()

    svc = A3IntegrationService(db_session)
    result = await svc.sync_annotation_status(voice_file.id)

    assert result["total_segments"] == 3
    assert result["ready_for_annotation"] == 1
    assert result["already_annotated"] == 1
    assert result["pending_asr"] == 1


@pytest.mark.asyncio
async def test_a5_list_audio_by_track(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    track_id = 12345

    for i in range(3):
        voice_file = VoiceFile(
            file_name=f"flight_track_{track_id}_{i}.mp3",
            file_path=f"/data/{i}.mp3",
            icao_code="VHHH",
            track_id=track_id,
            start_time_utc=now + timedelta(hours=i),
            end_time_utc=now + timedelta(hours=i, minutes=30),
            file_size=256000,
            a3_process_status=2,
            duration_ms=1800000,
        )
        db_session.add(voice_file)

    await db_session.commit()

    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_track(track_id)

    assert result["track_id"] == track_id
    assert result["file_count"] == 3
    assert len(result["files"]) == 3
    for file_info in result["files"]:
        assert file_info["track_id"] == track_id


@pytest.mark.asyncio
async def test_a5_list_audio_by_annotator(db_session: AsyncSession):
    now = datetime.now(timezone.utc)
    author_id = 999
    voice_file = VoiceFile(
        file_name="annotated_by_user.mp3",
        file_path="/data/annotated.mp3",
        icao_code="VHHH",
        start_time_utc=now,
        end_time_utc=now + timedelta(seconds=1800),
        a3_process_status=2,
        duration_ms=1800000,
    )
    db_session.add(voice_file)
    await db_session.commit()
    await db_session.refresh(voice_file)

    for i in range(2):
        segment = VoiceSegment(
            voice_file_id=voice_file.id,
            author_id=author_id,
            relative_start=float(i * 10),
            relative_end=float((i + 1) * 10),
            abs_start_time=now + timedelta(seconds=i * 10),
            abs_end_time=now + timedelta(seconds=(i + 1) * 10),
            asr_content=f"Text {i}",
            annotation_text=f"Annotated {i}",
            is_annotated=True,
            label_type="instruction",
        )
        db_session.add(segment)
    await db_session.commit()

    svc = A5IntegrationService(db_session)
    result = await svc.list_audio_by_annotator(author_id)

    assert result["author_id"] == author_id
    assert result["annotation_count"] == 2
    assert len(result["segments"]) == 2
    for segment_info in result["segments"]:
        assert segment_info["author_id"] == author_id
