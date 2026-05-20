"""A3CallbackService 单元测试 — Mock DB Session，不触碰真实数据库。"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.schemas.callback import A3CallbackRequest, A3SegmentPayload
from app.services.a3_callback_service import A3CallbackService

pytestmark = pytest.mark.unit


def _make_voice_file(fid: int = 1):
    vf = MagicMock()
    vf.id = fid
    vf.start_time_utc = datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
    vf.updated_at = datetime(2024, 1, 1, 0, 0, 1, tzinfo=timezone.utc)
    vf.a3_process_status = 0
    vf.error_log = None
    return vf


@pytest.mark.asyncio
async def test_handle_callback_inserts_segments(mock_db):
    """正常回调：插入 2 条 segment，返回正确 segment_count。"""
    vf = _make_voice_file()
    mock_db.get = AsyncMock(return_value=vf)

    payload = A3CallbackRequest(
        voice_file_id=1,
        process_status=2,
        segments=[
            A3SegmentPayload(relative_start=0.0, relative_end=1.5, asr_content="alpha"),
            A3SegmentPayload(relative_start=1.5, relative_end=3.0, asr_content="bravo"),
        ],
    )

    svc = A3CallbackService(mock_db)
    resp = await svc.handle_callback(payload)

    assert resp.segment_count == 2
    assert mock_db.add.call_count == 2
    assert mock_db.execute.await_count == 2
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_handle_callback_voice_file_not_found(mock_db):
    """voice_file_id 不存在时抛出 404。"""
    mock_db.get = AsyncMock(return_value=None)

    payload = A3CallbackRequest(voice_file_id=999, process_status=2, segments=[])
    svc = A3CallbackService(mock_db)

    with pytest.raises(HTTPException) as exc_info:
        await svc.handle_callback(payload)
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_handle_callback_empty_segments(mock_db):
    """segments 为空时正常返回，segment_count=0，不调用 add。"""
    vf = _make_voice_file()
    mock_db.get = AsyncMock(return_value=vf)

    payload = A3CallbackRequest(voice_file_id=1, process_status=2, segments=[])
    svc = A3CallbackService(mock_db)
    resp = await svc.handle_callback(payload)

    assert resp.segment_count == 0
    mock_db.add.assert_not_called()


@pytest.mark.asyncio
async def test_handle_callback_invalid_segment_range_400(mock_db):
    vf = _make_voice_file()
    mock_db.get = AsyncMock(return_value=vf)

    bad_segment = A3SegmentPayload.model_construct(relative_start=1.0, relative_end=1.0, asr_content="bad")
    payload = A3CallbackRequest.model_construct(voice_file_id=1, process_status=2, segments=[bad_segment])
    svc = A3CallbackService(mock_db)

    with pytest.raises(HTTPException) as exc_info:
        await svc.handle_callback(payload)

    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_handle_callback_updates_existing_segment(mock_db):
    vf = _make_voice_file()
    mock_db.get = AsyncMock(return_value=vf)

    existing = MagicMock()
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = existing
    mock_db.execute = AsyncMock(return_value=execute_result)

    payload = A3CallbackRequest(
        voice_file_id=1,
        process_status=2,
        segments=[
            A3SegmentPayload(relative_start=0.0, relative_end=2.0, asr_content="updated", vad_confidence=0.8),
        ],
    )

    svc = A3CallbackService(mock_db)
    resp = await svc.handle_callback(payload)

    assert resp.segment_count == 1
    assert existing.asr_content == "updated"
    assert existing.vad_confidence == 0.8
    mock_db.add.assert_called_once_with(existing)


@pytest.mark.asyncio
async def test_handle_callback_sets_optional_fields_on_insert(mock_db):
    vf = _make_voice_file()
    mock_db.get = AsyncMock(return_value=vf)

    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    mock_db.execute = AsyncMock(return_value=execute_result)

    payload = A3CallbackRequest(
        voice_file_id=1,
        process_status=2,
        segments=[
            A3SegmentPayload(
                relative_start=0.0,
                relative_end=3.0,
                asr_content="alpha",
                vad_confidence=0.6,
                model_info="vad-v1",
                storage_tag="s3",
            )
        ],
    )

    svc = A3CallbackService(mock_db)
    await svc.handle_callback(payload)

    created = mock_db.add.call_args.args[0]
    assert created.vad_confidence == 0.6
    assert created.model_info == "vad-v1"
    assert created.storage_tag == "s3"
