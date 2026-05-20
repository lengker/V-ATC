"""LiveATCIngestionService 单元测试。"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services.ingestion_service import LiveATCIngestionService
from tests.shared.time_utils import utc_datetime

pytestmark = pytest.mark.unit


_utc = utc_datetime


class _StreamResponse:
    def __init__(self, chunks: list[bytes], status_code: int = 200):
        self._chunks = chunks
        self.status_code = status_code

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("GET", "https://d.liveatc.net/vhhh5")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError("http error", request=request, response=response)

    async def aiter_bytes(self, chunk_size: int = 8192):
        for chunk in self._chunks:
            yield chunk


class _AsyncClientContext:
    def __init__(self, stream_response: _StreamResponse):
        self._stream_response = stream_response

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method: str, url: str, follow_redirects: bool = True):
        return self._stream_response


@pytest.fixture
def svc(mock_db):
    return LiveATCIngestionService(mock_db)


@pytest.mark.asyncio
async def test_register_realtime_capture(mock_db, svc):
    await svc.register_realtime_capture(
        file_name="live_001.mp3",
        file_path="/audio/live_001.mp3",
        start_time_utc=_utc(2024, 1, 1, 0),
        end_time_utc=_utc(2024, 1, 1, 0, 30),
        source_url="http://liveatc.example/feed",
        file_size=1024,
        duration_ms=1800000,
    )
    mock_db.add.assert_called_once()
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_register_historical_capture(mock_db, svc):
    with patch("app.services.ingestion_service.Path.mkdir"):
        await svc.register_historical_capture(
            file_name="hist_001.mp3",
            source_url="http://liveatc.example/archive/hist_001.mp3",
            start_time_utc=_utc(2024, 1, 1, 0),
            end_time_utc=_utc(2024, 1, 1, 1),
        )
    mock_db.add.assert_called_once()
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_has_source_url_true(mock_db, svc):
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = 1
    mock_db.execute.return_value = execute_result

    assert await svc.has_source_url("https://archive.liveatc.net/vhhh5/a.mp3") is True


@pytest.mark.asyncio
async def test_has_source_url_false(mock_db, svc):
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = execute_result

    assert await svc.has_source_url("https://archive.liveatc.net/vhhh5/missing.mp3") is False


def test_floor_to_half_hour(svc):
    assert svc.floor_to_half_hour(_utc(2026, 4, 13, 10, 0, 3)) == _utc(2026, 4, 13, 10, 0, 0)
    assert svc.floor_to_half_hour(_utc(2026, 4, 13, 10, 29, 59)) == _utc(2026, 4, 13, 10, 0, 0)
    assert svc.floor_to_half_hour(_utc(2026, 4, 13, 10, 30, 1)) == _utc(2026, 4, 13, 10, 30, 0)
    assert svc.floor_to_half_hour(_utc(2026, 4, 13, 10, 59, 59)) == _utc(2026, 4, 13, 10, 30, 0)


def test_estimate_realtime_segment_bounds_short_capture(svc):
    start = _utc(2026, 4, 13, 0, 0)
    end = start + timedelta(seconds=60)
    seg_start, seg_end = svc.estimate_realtime_segment_bounds(start, end)
    assert seg_start == start
    assert seg_end == end


def test_estimate_realtime_segment_bounds_full_window(svc):
    start = _utc(2026, 4, 13, 0, 3)
    end = start + timedelta(seconds=1750)
    seg_start, seg_end = svc.estimate_realtime_segment_bounds(start, end)
    assert seg_start == _utc(2026, 4, 13, 0, 0)
    assert seg_end == _utc(2026, 4, 13, 0, 30)


def test_extract_utc_range_from_filename(svc):
    parsed = svc.extract_utc_range_from_filename("VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0000Z.mp3")
    assert parsed is not None
    start, end = parsed
    assert start == _utc(2026, 4, 13, 0, 0)
    assert end == _utc(2026, 4, 13, 0, 30)


def test_extract_utc_range_from_filename_invalid(svc):
    assert svc.extract_utc_range_from_filename("VHHH5-Invalid-Format.mp3") is None
    assert svc.extract_utc_range_from_filename("VHHH5-App-Dep-Dir-Zone-Apr-13-2026-2500Z.mp3") is None


@pytest.mark.asyncio
async def test_register_historical_download_streamed(mock_db, svc, tmp_audio_storage):
    async def _iter_bytes():
        yield b"abc"
        yield b"def"

    now = _utc(2026, 4, 13, 0, 0)
    row = await svc.register_historical_download(
        file_name="VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0000Z.mp3",
        source_url="https://archive.liveatc.net/vhhh5/VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0000Z.mp3",
        byte_iter=_iter_bytes(),
        now=now,
    )

    assert row is not None
    assert row.file_size == 6
    assert row.start_time_utc == _utc(2026, 4, 13, 0, 0)
    assert row.end_time_utc == _utc(2026, 4, 13, 0, 30)
    assert Path(row.file_path).exists()
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_register_historical_download_empty_bytes_returns_none(svc, tmp_audio_storage):
    async def _empty_iter():
        yield b""
        yield b""

    now = _utc(2026, 4, 13, 1, 0)
    row = await svc.register_historical_download(
        file_name="VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0100Z.mp3",
        source_url="https://archive.liveatc.net/vhhh5/VHHH5-App-Dep-Dir-Zone-Apr-13-2026-0100Z.mp3",
        byte_iter=_empty_iter(),
        now=now,
    )

    target_dir = tmp_audio_storage / "historical" / now.strftime("%Y%m%d")
    assert row is None
    assert list(target_dir.glob("*.mp3")) == []


@pytest.mark.asyncio
async def test_capture_realtime_stream_success(mock_db, svc, tmp_audio_storage):
    stream_response = _StreamResponse([b"abc", b"def"])
    client_ctx = _AsyncClientContext(stream_response)
    capture_start = _utc(2026, 4, 20, 12, 0, 0)
    capture_end = _utc(2026, 4, 20, 12, 0, 10)

    with patch("app.services.ingestion_service.httpx.AsyncClient", return_value=client_ctx), patch.object(
        svc, "utc_now", side_effect=[capture_start, capture_end]
    ):
        row = await svc.capture_realtime_stream(
            stream_url="https://d.liveatc.net/vhhh5",
            timeout_seconds=30,
            max_bytes=1024,
            request_headers={"User-Agent": "pytest"},
        )

    realtime_dir = tmp_audio_storage / "realtime" / capture_start.strftime("%Y%m%d")
    assert row is not None
    assert row.file_size == 6
    assert row.source_url == "https://d.liveatc.net/vhhh5"
    assert row.start_time_utc == capture_start
    assert row.end_time_utc == capture_end
    assert len(list(realtime_dir.glob("*.mp3"))) == 1
    mock_db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_capture_realtime_stream_zero_bytes_returns_none(svc, tmp_audio_storage):
    stream_response = _StreamResponse([b"", b""])
    client_ctx = _AsyncClientContext(stream_response)
    capture_start = _utc(2026, 4, 20, 12, 1, 0)
    capture_end = _utc(2026, 4, 20, 12, 1, 5)

    with patch("app.services.ingestion_service.httpx.AsyncClient", return_value=client_ctx), patch.object(
        svc, "utc_now", side_effect=[capture_start, capture_end]
    ):
        row = await svc.capture_realtime_stream(
            stream_url="https://d.liveatc.net/vhhh5",
            timeout_seconds=30,
            max_bytes=1024,
        )

    realtime_dir = tmp_audio_storage / "realtime" / capture_start.strftime("%Y%m%d")
    assert row is None
    assert list(realtime_dir.glob("*.mp3")) == []
