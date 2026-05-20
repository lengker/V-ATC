"""AudioQueryService 单元测试。"""
from __future__ import annotations

import pytest
from sqlalchemy import delete, insert

from app.db.models import VoiceFile, VoiceSegment
from app.services.query_service import AudioQueryService
from tests.shared.time_utils import jan1_2024_utc

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_find_segments_returns_overlaps_in_time_order(db_session):
    await db_session.execute(delete(VoiceSegment))
    await db_session.execute(delete(VoiceFile))
    await db_session.execute(
        insert(VoiceFile).values(
            id=201,
            file_name="query.mp3",
            file_path="/audio/query.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(2),
            status=1,
            a3_process_status=2,
            duration_ms=7200000,
            file_size=2048,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            [
                {
                    "id": 301,
                    "voice_file_id": 201,
                    "relative_start": 0.0,
                    "relative_end": 60.0,
                    "abs_start_time": jan1_2024_utc(0, 0),
                    "abs_end_time": jan1_2024_utc(0, 1),
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 302,
                    "voice_file_id": 201,
                    "relative_start": 60.0,
                    "relative_end": 120.0,
                    "abs_start_time": jan1_2024_utc(0, 1),
                    "abs_end_time": jan1_2024_utc(0, 2),
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
                {
                    "id": 303,
                    "voice_file_id": 201,
                    "relative_start": 120.0,
                    "relative_end": 180.0,
                    "abs_start_time": jan1_2024_utc(2, 0),
                    "abs_end_time": jan1_2024_utc(2, 1),
                    "is_annotated": False,
                    "created_at": jan1_2024_utc(0),
                    "updated_at": jan1_2024_utc(0),
                },
            ]
        )
    )
    await db_session.commit()

    svc = AudioQueryService(db_session)
    rows = await svc.find_segments(jan1_2024_utc(0, 0, 30), jan1_2024_utc(0, 1, 30))

    assert [row.id for row in rows] == [301, 302]


@pytest.mark.asyncio
async def test_get_voice_file_returns_row_and_none_for_missing(db_session):
    await db_session.execute(
        insert(VoiceFile).values(
            id=202,
            file_name="exists.mp3",
            file_path="/audio/exists.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=0,
            duration_ms=3600000,
            file_size=512,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()

    svc = AudioQueryService(db_session)
    assert (await svc.get_voice_file(202)) is not None
    assert await svc.get_voice_file(999999) is None


def test_estimate_byte_range_handles_edge_cases():
    assert AudioQueryService.estimate_byte_range(
        duration_ms=None,
        file_size=1000,
        relative_start_sec=0.0,
        relative_end_sec=1.0,
    ) == (0, 1000)

    assert AudioQueryService.estimate_byte_range(
        duration_ms=10000,
        file_size=1000,
        relative_start_sec=6.0,
        relative_end_sec=5.0,
    ) == (0, 0)

    assert AudioQueryService.estimate_byte_range(
        duration_ms=10000,
        file_size=1000,
        relative_start_sec=2.0,
        relative_end_sec=4.0,
    ) == (200, 400)


@pytest.mark.asyncio
async def test_iter_file_stream_range_reads_exact_slice(db_session, tmp_path, override_settings):
    target = tmp_path / "slice.bin"
    payload = bytes(range(64))
    target.write_bytes(payload)

    override_settings(a2_chunk_size=7)
    svc = AudioQueryService(db_session)

    chunks = [
        chunk
        async for chunk in svc.iter_file_stream_range(
            file_path=str(target),
            start_byte=10,
            end_byte=27,
        )
    ]

    assert b"".join(chunks) == payload[10:27]


@pytest.mark.asyncio
async def test_iter_file_stream_range_clamps_bounds(db_session, tmp_path, override_settings):
    target = tmp_path / "clamp.bin"
    payload = b"abcdefghijklmnopqrstuvwxyz"
    target.write_bytes(payload)

    override_settings(a2_chunk_size=8)
    svc = AudioQueryService(db_session)

    chunks = [
        chunk
        async for chunk in svc.iter_file_stream_range(
            file_path=str(target),
            start_byte=-100,
            end_byte=999,
        )
    ]

    assert b"".join(chunks) == payload
