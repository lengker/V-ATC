from __future__ import annotations

import pytest_asyncio
from sqlalchemy import delete, insert

from app.db.models import VoiceFile, VoiceSegment
from tests.shared.time_utils import jan1_2024_utc


@pytest_asyncio.fixture
async def seeded_audio(db_session) -> None:
    await db_session.execute(delete(VoiceSegment))
    await db_session.execute(delete(VoiceFile))
    await db_session.execute(
        insert(VoiceFile).values(
            id=10,
            file_name="test.mp3",
            file_path="/audio/test.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(0),
            end_time_utc=jan1_2024_utc(1),
            status=1,
            a3_process_status=2,
            file_size=1024,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(0),
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            id=20,
            voice_file_id=10,
            author_id=88,
            relative_start=0.0,
            relative_end=10.0,
            abs_start_time=jan1_2024_utc(0),
            abs_end_time=jan1_2024_utc(0, 1),
            is_annotated=False,
            created_at=jan1_2024_utc(0),
            updated_at=jan1_2024_utc(0),
        )
    )
    await db_session.commit()


@pytest_asyncio.fixture
async def seeded_a5_audio(db_session) -> None:
    await db_session.execute(delete(VoiceSegment))
    await db_session.execute(delete(VoiceFile))
    await db_session.execute(
        insert(VoiceFile).values(
            id=30,
            track_id=9001,
            file_name="a5_test.mp3",
            file_path="/audio/a5_test.mp3",
            icao_code="VHHH",
            start_time_utc=jan1_2024_utc(2),
            end_time_utc=jan1_2024_utc(3),
            status=1,
            a3_process_status=2,
            file_size=2048,
            duration_ms=3600000,
            last_access_at=jan1_2024_utc(2),
            created_at=jan1_2024_utc(2),
            updated_at=jan1_2024_utc(2),
        )
    )
    await db_session.execute(
        insert(VoiceSegment).values(
            id=31,
            voice_file_id=30,
            author_id=42,
            relative_start=0.0,
            relative_end=5.0,
            abs_start_time=jan1_2024_utc(2),
            abs_end_time=jan1_2024_utc(2, 0, 5),
            asr_content="alpha",
            annotation_text="bravo",
            is_annotated=True,
            label_type="clearance",
            duration=5.0,
            created_at=jan1_2024_utc(2),
            updated_at=jan1_2024_utc(2),
        )
    )
    await db_session.commit()


@pytest_asyncio.fixture
async def voice_file_id(db_session) -> int:
    result = await db_session.execute(
        insert(VoiceFile).values(
            file_name="cb_test.mp3",
            file_path="/audio/cb_test.mp3",
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
    return int(result.inserted_primary_key[0])
