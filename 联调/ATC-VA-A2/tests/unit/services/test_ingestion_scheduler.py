"""LiveATCScheduler 单元测试。"""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.services.ingestion_scheduler import LiveATCScheduler
from app.services.liveatc_client import HistoricalAudioLink

pytestmark = pytest.mark.unit


class _DummySession:
    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, exc_type, exc, tb):
        return False


@pytest.mark.asyncio
async def test_start_and_stop_scheduler_lifecycle():
    scheduler = LiveATCScheduler()

    with patch.object(scheduler, "_realtime_loop", new=AsyncMock()), patch.object(
        scheduler, "_historical_loop", new=AsyncMock()
    ):
        await scheduler.start()
        assert scheduler.status()["running"] is True
        assert scheduler._realtime_task is not None
        assert scheduler._historical_task is not None

        await scheduler.stop()

    assert scheduler.status()["running"] is False
    assert scheduler._realtime_task is None
    assert scheduler._historical_task is None


@pytest.mark.asyncio
async def test_start_is_idempotent():
    scheduler = LiveATCScheduler()

    with patch.object(scheduler, "_realtime_loop", new=AsyncMock()), patch.object(
        scheduler, "_historical_loop", new=AsyncMock()
    ):
        await scheduler.start()
        first_realtime_task = scheduler._realtime_task
        first_historical_task = scheduler._historical_task

        await scheduler.start()

        assert scheduler._realtime_task is first_realtime_task
        assert scheduler._historical_task is first_historical_task
        await scheduler.stop()


@pytest.mark.asyncio
async def test_trigger_realtime_once_sets_error_when_exception():
    scheduler = LiveATCScheduler()

    with patch.object(scheduler, "_run_realtime_once", new=AsyncMock(side_effect=RuntimeError("boom"))):
        ok = await scheduler.trigger_realtime_once()

    assert ok is False
    assert scheduler.status()["last_error"] == "realtime: RuntimeError: boom"


@pytest.mark.asyncio
async def test_trigger_historical_once_sets_error_when_exception():
    scheduler = LiveATCScheduler()

    with patch.object(scheduler, "_run_historical_once", new=AsyncMock(side_effect=RuntimeError("boom"))):
        downloaded = await scheduler.trigger_historical_once()

    assert downloaded == 0
    assert scheduler.status()["last_error"] == "historical: RuntimeError: boom"


def test_backoff_delay_respects_range_and_max():
    scheduler = LiveATCScheduler()

    with patch("app.services.ingestion_scheduler.random.uniform", return_value=0.2):
        delay_0 = scheduler._backoff_delay(0)
        delay_3 = scheduler._backoff_delay(3)

    assert 0.1 <= delay_0 <= 30.0
    assert 0.1 <= delay_3 <= 30.0
    assert delay_3 >= delay_0


def test_interval_delay_applies_bounded_jitter(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_scheduler_interval_jitter_seconds=300)

    with patch("app.services.ingestion_scheduler.random.uniform", return_value=-120):
        assert scheduler._interval_delay(1800) == 1680


def test_bounded_random_delay_normalizes_invalid_range():
    scheduler = LiveATCScheduler()

    with patch("app.services.ingestion_scheduler.random.uniform", return_value=2.5) as mocked_random:
        delay = scheduler._bounded_random_delay(-5, 2)

    assert delay == 2.5
    mocked_random.assert_called_once_with(0.0, 2.0)


def test_status_formats_datetime_fields():
    scheduler = LiveATCScheduler()
    now = datetime.now(timezone.utc)
    scheduler._last_realtime_at = now
    scheduler._last_historical_at = now

    status = scheduler.status()
    assert status["last_realtime_at"] == now.isoformat()
    assert status["last_historical_at"] == now.isoformat()


def test_default_headers_include_cookie(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_http_cookie="session=abc123")

    headers = scheduler._default_headers()

    assert headers["Cookie"] == "session=abc123"
    assert headers["User-Agent"] == settings.a2_http_user_agent


def test_resolve_cookie_reads_file(tmp_path, override_settings):
    cookie_file = tmp_path / "cookie.txt"
    cookie_file.write_text("file_cookie=xyz", encoding="utf-8")
    override_settings(a2_http_cookie="", a2_http_cookie_file=str(cookie_file))

    scheduler = LiveATCScheduler()
    assert scheduler._resolve_cookie() == "file_cookie=xyz"


def test_http_timeout_returns_expected_values():
    scheduler = LiveATCScheduler()
    timeout = scheduler._http_timeout()

    assert timeout.connect == 10.0
    assert timeout.read == 20.0
    assert timeout.write == 10.0
    assert timeout.pool == 10.0


@pytest.mark.asyncio
async def test_sleep_human_delay_awaits_random_interval(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_liveatc_human_delay_min_seconds=1.0, a2_liveatc_human_delay_max_seconds=2.0)

    with patch("app.services.ingestion_scheduler.random.uniform", return_value=1.5), patch(
        "app.services.ingestion_scheduler.asyncio.sleep", new=AsyncMock()
    ) as mocked_sleep:
        await scheduler._sleep_human_delay()

    mocked_sleep.assert_awaited_once_with(1.5)


@pytest.mark.asyncio
async def test_sleep_download_gap_awaits_random_interval(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_liveatc_download_gap_min_seconds=2.0, a2_liveatc_download_gap_max_seconds=3.0)

    with patch("app.services.ingestion_scheduler.random.uniform", return_value=2.5), patch(
        "app.services.ingestion_scheduler.asyncio.sleep", new=AsyncMock()
    ) as mocked_sleep:
        await scheduler._sleep_download_gap()

    mocked_sleep.assert_awaited_once_with(2.5)


@pytest.mark.asyncio
async def test_run_realtime_once_skips_when_storage_low():
    scheduler = LiveATCScheduler()
    dummy_session = AsyncMock()

    def session_factory():
        return _DummySession(dummy_session)

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory), patch(
        "app.services.ingestion_scheduler.StorageManagerService.ensure_capacity_for_new_download",
        new=AsyncMock(return_value=False),
    ):
        ok = await scheduler._run_realtime_once()

    assert ok is False
    assert scheduler.status()["last_error"] == "storage low: skipped realtime capture"


@pytest.mark.asyncio
async def test_run_realtime_once_success(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_http_max_retries=1)
    dummy_session = AsyncMock()

    class DummyAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return MagicMock()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    def session_factory():
        return _DummySession(dummy_session)

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory), patch(
        "app.services.ingestion_scheduler.httpx.AsyncClient", DummyAsyncClient
    ), patch(
        "app.services.ingestion_scheduler.StorageManagerService.ensure_capacity_for_new_download",
        new=AsyncMock(return_value=True),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.capture_realtime_stream",
        new=AsyncMock(return_value=MagicMock()),
    ), patch.object(
        scheduler.client, "ensure_public_session_cookie", new=AsyncMock(return_value=True)
    ), patch.object(
        scheduler.client, "cookie_count", return_value=2
    ), patch.object(
        scheduler.client, "resolve_realtime_stream_url", new=AsyncMock(return_value="http://example.com/stream")
    ), patch.object(
        scheduler.client, "enrich_headers_with_session_cookie", new=AsyncMock(return_value={"User-Agent": "ua"})
    ):
        ok = await scheduler._run_realtime_once()

    assert ok is True
    assert scheduler.status()["last_realtime_at"] is not None
    assert scheduler.status()["last_error"] is None


@pytest.mark.asyncio
async def test_run_historical_once_downloads_first_link(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_http_max_retries=1, a2_historical_max_files_per_run=1)
    dummy_session = AsyncMock()

    class DummyStreamResponse:
        status_code = 200
        headers = {"content-type": "audio/mpeg"}

        async def aiter_bytes(self, chunk_size=1):
            yield b"audio"

    class DummyStream:
        async def __aenter__(self):
            return DummyStreamResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class DummyAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return DummyStream()

    def session_factory():
        return _DummySession(dummy_session)

    link = HistoricalAudioLink(
        url="http://example.com/archive.mp3",
        file_name="VHHH5-App-Dep-Dir-Zone-Jan-01-2024-0000Z.mp3",
    )

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory), patch(
        "app.services.ingestion_scheduler.httpx.AsyncClient", DummyAsyncClient
    ), patch(
        "app.services.ingestion_scheduler.StorageManagerService.ensure_capacity_for_new_download",
        new=AsyncMock(return_value=True),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.has_source_url",
        new=AsyncMock(return_value=False),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.register_historical_download",
        new=AsyncMock(return_value=MagicMock()),
    ), patch.object(
        scheduler.client, "ensure_public_session_cookie", new=AsyncMock(return_value=True)
    ), patch.object(
        scheduler.client, "cookie_count", return_value=1
    ), patch.object(
        scheduler.client, "list_historical_links", new=AsyncMock(return_value=[link])
    ), patch.object(
        scheduler.client, "build_archive_urls", return_value=[]
    ):
        downloaded = await scheduler._run_historical_once()

    status = scheduler.status()
    assert downloaded == 1
    assert status["last_historical_found"] == 1
    assert status["last_historical_downloaded"] == 1
    assert status["last_historical_failed"] == 0


@pytest.mark.asyncio
async def test_run_historical_once_uses_browser_request_bytes_when_stream_forbidden(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_http_max_retries=1, a2_historical_max_files_per_run=1)
    dummy_session = AsyncMock()

    class DummyStreamResponse:
        status_code = 403

        async def aiter_bytes(self, chunk_size=1):
            if False:
                yield b""

    class DummyStream:
        async def __aenter__(self):
            return DummyStreamResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class DummyAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return DummyStream()

    def session_factory():
        return _DummySession(dummy_session)

    link = HistoricalAudioLink(
        url="http://example.com/archive.mp3",
        file_name="VHHH5-App-Dep-Dir-Zone-Jan-01-2024-0000Z.mp3",
        referer_url="https://www.liveatc.net/archive.php?m=vhhh5",
    )

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory), patch(
        "app.services.ingestion_scheduler.httpx.AsyncClient", DummyAsyncClient
    ), patch(
        "app.services.ingestion_scheduler.StorageManagerService.ensure_capacity_for_new_download",
        new=AsyncMock(return_value=True),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.has_source_url",
        new=AsyncMock(return_value=False),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.register_historical_download",
        new=AsyncMock(return_value=MagicMock()),
    ), patch.object(
        scheduler.client, "ensure_public_session_cookie", new=AsyncMock(return_value=True)
    ), patch.object(
        scheduler.client, "cookie_count", return_value=1
    ), patch.object(
        scheduler.client, "list_historical_links", new=AsyncMock(return_value=[link])
    ), patch.object(
        scheduler.client, "build_archive_urls", return_value=[]
    ), patch.object(
        scheduler.client, "_browser_request_get", return_value=(200, b"audio-bytes", "")
    ) as mocked_request, patch.object(
        scheduler.client, "_browser_fetch_bytes", return_value=(200, b"audio-bytes")
    ) as mocked_fetch_bytes:
        downloaded = await scheduler._run_historical_once()

    assert downloaded == 1
    mocked_request.assert_called_once()
    mocked_fetch_bytes.assert_not_called()


@pytest.mark.asyncio
async def test_run_historical_once_rejects_html_response(override_settings):
    scheduler = LiveATCScheduler()
    override_settings(a2_http_max_retries=1, a2_historical_max_files_per_run=1)
    dummy_session = AsyncMock()

    class DummyStreamResponse:
        status_code = 200
        headers = {"content-type": "text/html; charset=UTF-8"}

        async def aiter_bytes(self, chunk_size=1):
            yield b"<!DOCTYPE html><html><title>Just a moment...</title></html>"

    class DummyStream:
        async def __aenter__(self):
            return DummyStreamResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class DummyAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def stream(self, *args, **kwargs):
            return DummyStream()

    def session_factory():
        return _DummySession(dummy_session)

    link = HistoricalAudioLink(
        url="http://example.com/archive.mp3",
        file_name="VHHH5-App-Dep-Dir-Zone-Jan-01-2024-0000Z.mp3",
    )
    register = AsyncMock(return_value=MagicMock())

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory), patch(
        "app.services.ingestion_scheduler.httpx.AsyncClient", DummyAsyncClient
    ), patch(
        "app.services.ingestion_scheduler.StorageManagerService.ensure_capacity_for_new_download",
        new=AsyncMock(return_value=True),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.has_source_url",
        new=AsyncMock(return_value=False),
    ), patch(
        "app.services.ingestion_scheduler.LiveATCIngestionService.register_historical_download",
        new=register,
    ), patch.object(
        scheduler.client, "ensure_public_session_cookie", new=AsyncMock(return_value=True)
    ), patch.object(
        scheduler.client, "cookie_count", return_value=1
    ), patch.object(
        scheduler.client, "list_historical_links", new=AsyncMock(return_value=[link])
    ), patch.object(
        scheduler.client, "build_archive_urls", return_value=[]
    ):
        downloaded = await scheduler._run_historical_once()

    status = scheduler.status()
    assert downloaded == 0
    assert status["last_historical_found"] == 1
    assert status["last_historical_downloaded"] == 0
    assert status["last_historical_failed"] == 1
    assert status["last_historical_first_failed_status"] == 200
    register.assert_not_awaited()
