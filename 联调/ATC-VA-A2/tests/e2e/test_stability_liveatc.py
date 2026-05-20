"""LiveATC 真实网络长稳测试。"""
from __future__ import annotations

import asyncio
import os
from time import monotonic
from unittest.mock import patch

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db.base import Base

pytestmark = [pytest.mark.e2e, pytest.mark.network, pytest.mark.longrun]


@pytest_asyncio.fixture
async def longrun_scheduler_isolation(tmp_path, override_settings):
    db_path = tmp_path / "longrun_scheduler.db"
    audio_dir = tmp_path / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path.as_posix()}", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, autoflush=False, autocommit=False, expire_on_commit=False)

    override_settings(
        a2_audio_storage=str(audio_dir),
        a2_http_max_retries=1,
        a2_realtime_capture_seconds=5,
        a2_realtime_capture_max_bytes=65536,
        a2_historical_max_files_per_run=1,
    )

    with patch("app.services.ingestion_scheduler.SessionLocal", session_factory):
        yield

    await engine.dispose()


@pytest.mark.asyncio
async def test_liveatc_realtime_long_stability(client, longrun_scheduler_isolation):
    duration_seconds = int(os.getenv("A2_LONGRUN_SECONDS", "600"))
    interval_seconds = int(os.getenv("A2_LONGRUN_INTERVAL_SECONDS", "30"))
    include_historical = os.getenv("A2_LONGRUN_INCLUDE_HISTORICAL", "0") == "1"
    historical_every = max(int(os.getenv("A2_LONGRUN_HISTORICAL_EVERY", "6")), 1)

    deadline = monotonic() + max(duration_seconds, 60)
    iteration = 0

    while monotonic() < deadline:
        loop_start = monotonic()
        iteration += 1

        realtime_resp = await client.post("/api/v1/ingestion/scheduler/trigger/realtime")
        assert realtime_resp.status_code == 200

        if include_historical and iteration % historical_every == 0:
            historical_resp = await client.post("/api/v1/ingestion/scheduler/trigger/historical")
            assert historical_resp.status_code == 200

        status_resp = await client.get("/api/v1/ingestion/scheduler/status")
        assert status_resp.status_code == 200
        assert "running" in status_resp.json()

        sleep_until = loop_start + max(interval_seconds, 1)
        remaining = sleep_until - monotonic()
        if remaining > 0:
            await asyncio.sleep(remaining)
