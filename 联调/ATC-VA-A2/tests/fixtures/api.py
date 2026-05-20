from __future__ import annotations

import pytest

from app.core.config import settings


@pytest.fixture
def a3_callback_headers(override_settings) -> dict[str, str]:
    override_settings(a3_callback_token="test-a3-token")
    return {"X-A3-Token": settings.a3_callback_token}


@pytest.fixture
def api_token_headers(override_settings) -> dict[str, str]:
    override_settings(api_token="test-api-token")
    return {"X-Api-Token": settings.api_token}


@pytest.fixture
def realtime_register_payload() -> dict[str, object]:
    return {
        "file_name": "live_001.mp3",
        "file_path": "/audio/live_001.mp3",
        "start_time_utc": "2024-01-01T00:00:00Z",
        "end_time_utc": "2024-01-01T00:30:00Z",
        "source_url": "http://liveatc.example/feed",
        "file_size": 1024,
        "duration_ms": 1800000,
    }


@pytest.fixture
def historical_register_payload() -> dict[str, object]:
    return {
        "file_name": "hist_001.mp3",
        "source_url": "http://liveatc.example/archive/hist_001.mp3",
        "start_time_utc": "2024-01-01T00:00:00Z",
        "end_time_utc": "2024-01-01T01:00:00Z",
    }
