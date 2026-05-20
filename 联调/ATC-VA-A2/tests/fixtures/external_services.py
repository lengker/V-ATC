from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest


@pytest.fixture
def network_guard() -> Callable[[Awaitable[Any]], Awaitable[Any]]:
    try:
        timeout_seconds = float(os.getenv("A2_TEST_NETWORK_TIMEOUT", "30"))
    except ValueError:
        timeout_seconds = 30
    timeout_seconds = max(timeout_seconds, 1.0)

    async def _network_guard(coro: Awaitable[Any]) -> Any:
        try:
            return await asyncio.wait_for(coro, timeout=timeout_seconds)
        except (asyncio.TimeoutError, httpx.TimeoutException, httpx.NetworkError, httpx.RequestError) as exc:
            pytest.skip(f"LiveATC network unavailable or too slow: {exc}")

    return _network_guard


@pytest.fixture
def scheduler_status_payload() -> Callable[[bool], dict[str, str | bool | int | None]]:
    def _build(running: bool) -> dict[str, str | bool | int | None]:
        return {
            "running": running,
            "icao_code": "VHHH",
            "last_error": None,
            "last_realtime_at": None,
            "last_historical_at": None,
            "last_historical_found": 0,
            "last_historical_skipped": 0,
            "last_historical_downloaded": 0,
            "last_historical_failed": 0,
            "last_historical_first_failed_status": None,
            "last_cookie_warmup_ok": None,
            "last_cookie_count": 0,
        }

    return _build
