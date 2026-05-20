"""audio 路由集成测试 — 使用内存 DB，Mock asyncio.to_thread 避免真实文件读取。"""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_stream_audio_returns_206(client, seeded_audio):
    """时间范围命中 segment 时返回 206 流式响应。"""
    class MockFile:
        def seek(self, *args, **kwargs):
            return 0

        def read(self, *args, **kwargs):
            return b"a" * min(args[0], 64) if args else b""

        def close(self):
            pass

    async def fake_to_thread(fn, *args):
        if fn is os.path.getsize:
            return 1024
        if hasattr(fn, "__name__") and fn.__name__ == "_open_file":
            return MockFile()
        return fn(*args)

    with patch("app.api.routes.audio.os.path.exists", return_value=True), patch(
        "app.services.query_service.asyncio.to_thread", side_effect=fake_to_thread
    ):
        resp = await client.get(
            "/api/v1/audio/stream",
            params={
                "start_time_utc": "2024-01-01T00:00:00Z",
                "end_time_utc": "2024-01-01T00:30:00Z",
            },
        )
    assert resp.status_code == 206


@pytest.mark.asyncio
async def test_stream_audio_no_segment_404(client):
    """时间范围无 segment 时返回 404。"""
    resp = await client.get(
        "/api/v1/audio/stream",
        params={
            "start_time_utc": "2099-01-01T00:00:00Z",
            "end_time_utc": "2099-01-01T01:00:00Z",
        },
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_stream_audio_bad_range_400(client):
    """end_time <= start_time 时返回 400。"""
    resp = await client.get(
        "/api/v1/audio/stream",
        params={
            "start_time_utc": "2024-01-01T01:00:00Z",
            "end_time_utc": "2024-01-01T00:00:00Z",
        },
    )
    assert resp.status_code == 400
