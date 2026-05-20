"""ingestion 路由集成测试。"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base

pytestmark = pytest.mark.integration


@pytest_asyncio.fixture
async def scheduler_network_isolation(tmp_path, override_settings):
    db_path = tmp_path / "scheduler_network.db"
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path.as_posix()}", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, autoflush=False, autocommit=False, expire_on_commit=False)

    override_settings(
        a2_audio_storage=str(audio_dir),
        a2_http_max_retries=1,
        a2_http_backoff_base_seconds=0.1,
        a2_http_backoff_max_seconds=0.2,
        a2_realtime_capture_seconds=5,
        a2_realtime_capture_max_bytes=65536,
        a2_historical_max_files_per_run=1,
    )

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory):
        yield

    await engine.dispose()


@pytest.mark.asyncio
async def test_register_realtime_file(client, realtime_register_payload):
    resp = await client.post("/api/v1/ingestion/realtime/register", json=realtime_register_payload)
    assert resp.status_code == 201
    assert "voice_file_id" in resp.json()


@pytest.mark.asyncio
async def test_register_historical_file(client, historical_register_payload):
    with patch("app.services.ingestion_service.Path.mkdir"):
        resp = await client.post("/api/v1/ingestion/historical/register", json=historical_register_payload)
    assert resp.status_code == 201
    assert "voice_file_id" in resp.json()


@pytest.mark.asyncio
async def test_scheduler_start_endpoint(client, scheduler_status_payload):
    status_payload = scheduler_status_payload(True)
    with patch("app.api.routes.ingestion.liveatc_scheduler.start", AsyncMock()) as mocked_start, patch(
        "app.api.routes.ingestion.liveatc_scheduler.status", MagicMock(return_value=status_payload)
    ):
        resp = await client.post("/api/v1/ingestion/scheduler/start")
    assert resp.status_code == 200
    assert resp.json()["status"]["running"] is True
    mocked_start.assert_awaited_once()


@pytest.mark.asyncio
async def test_scheduler_stop_endpoint(client, scheduler_status_payload):
    status_payload = scheduler_status_payload(False)
    with patch("app.api.routes.ingestion.liveatc_scheduler.stop", AsyncMock()) as mocked_stop, patch(
        "app.api.routes.ingestion.liveatc_scheduler.status", MagicMock(return_value=status_payload)
    ):
        resp = await client.post("/api/v1/ingestion/scheduler/stop")
    assert resp.status_code == 200
    assert resp.json()["status"]["running"] is False
    mocked_stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_scheduler_status(client):
    resp = await client.get("/api/v1/ingestion/scheduler/status")
    assert resp.status_code == 200
    assert "running" in resp.json()


@pytest.mark.asyncio
async def test_trigger_historical_download_mocked(client):
    with patch("app.api.routes.ingestion.liveatc_scheduler.trigger_historical_once", AsyncMock(return_value=2)):
        resp = await client.post("/api/v1/ingestion/scheduler/trigger/historical")
    assert resp.status_code == 200
    assert resp.json()["downloaded"] == 2
    assert "error" in resp.json()


@pytest.mark.asyncio
async def test_trigger_realtime_once_mocked(client):
    with patch("app.api.routes.ingestion.liveatc_scheduler.trigger_realtime_once", AsyncMock(return_value=True)):
        resp = await client.post("/api/v1/ingestion/scheduler/trigger/realtime")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert "error" in resp.json()


@pytest.mark.asyncio
async def test_trigger_realtime_error_unchanged_returns_none(client):
    with patch("app.api.routes.ingestion.liveatc_scheduler.trigger_realtime_once", AsyncMock(return_value=False)), patch(
        "app.api.routes.ingestion.liveatc_scheduler.status",
        MagicMock(side_effect=[{"last_error": "same"}, {"last_error": "same"}]),
    ):
        resp = await client.post("/api/v1/ingestion/scheduler/trigger/realtime")
    assert resp.status_code == 200
    assert resp.json()["error"] is None


@pytest.mark.network
@pytest.mark.asyncio
async def test_trigger_realtime_once_real_network(client, scheduler_network_isolation, network_guard):
    with patch("app.services.ingestion_scheduler.LiveATCScheduler._http_timeout", return_value=httpx.Timeout(5.0)):
        resp = await network_guard(client.post("/api/v1/ingestion/scheduler/trigger/realtime"))
    payload = resp.json()
    assert resp.status_code == 200
    assert "ok" in payload
    assert "error" in payload


@pytest.mark.network
@pytest.mark.asyncio
async def test_trigger_historical_once_real_network(client, scheduler_network_isolation, network_guard):
    with patch("app.services.ingestion_scheduler.LiveATCScheduler._http_timeout", return_value=httpx.Timeout(5.0)):
        resp = await network_guard(client.post("/api/v1/ingestion/scheduler/trigger/historical"))
    payload = resp.json()
    assert resp.status_code == 200
    assert "downloaded" in payload
    assert "found" in payload
    assert "skipped" in payload
