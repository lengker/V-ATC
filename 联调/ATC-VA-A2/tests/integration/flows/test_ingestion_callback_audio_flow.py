"""跨路由流程测试：ingestion -> callback -> audio。"""
from __future__ import annotations

from datetime import timedelta, timezone

import pytest
from sqlalchemy import select

from app.db.models import VoiceSegment

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_realtime_register_then_callback_then_stream(client, db_session, tmp_path, a3_callback_headers):
    audio_path = tmp_path / "flow.mp3"
    audio_bytes = (b"flow-bytes-" * 64)
    audio_path.write_bytes(audio_bytes)

    register_payload = {
        "file_name": "flow.mp3",
        "file_path": audio_path.as_posix(),
        "start_time_utc": "2024-01-01T02:00:00Z",
        "end_time_utc": "2024-01-01T02:30:00Z",
        "source_url": "http://liveatc.example/feed",
        "file_size": len(audio_bytes),
        "duration_ms": 1800000,
    }
    reg_resp = await client.post("/api/v1/ingestion/realtime/register", json=register_payload)
    assert reg_resp.status_code == 201
    voice_file_id = reg_resp.json()["voice_file_id"]

    callback_payload = {
        "voice_file_id": voice_file_id,
        "process_status": 2,
        "segments": [
            {"relative_start": 0.0, "relative_end": 30.0, "asr_content": "flow-segment"},
        ],
    }
    cb_resp = await client.post("/api/v1/a3/callback", json=callback_payload, headers=a3_callback_headers)
    assert cb_resp.status_code == 201
    assert cb_resp.json()["segment_count"] == 1

    segment = (
        await db_session.execute(
            select(VoiceSegment).where(VoiceSegment.voice_file_id == voice_file_id).limit(1)
        )
    ).scalar_one()

    start_dt = segment.abs_start_time + timedelta(seconds=1)
    end_dt = segment.abs_end_time - timedelta(seconds=1)

    def _to_utc_iso(value) -> str:
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    stream_resp = await client.get(
        "/api/v1/audio/stream",
        params={
            "start_time_utc": _to_utc_iso(start_dt),
            "end_time_utc": _to_utc_iso(end_dt),
        },
    )

    assert stream_resp.status_code == 206, stream_resp.text
    assert stream_resp.headers["X-Voice-File-Id"] == str(voice_file_id)
    assert len(stream_resp.content) > 0
