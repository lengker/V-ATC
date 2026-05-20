"""health 路由集成测试。"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_health_check_returns_expected_payload(client):
    resp = await client.get("/health")

    assert resp.status_code == 200
    payload = resp.json()
    assert payload["status"] == "ok"
    assert isinstance(payload["service"], str)
    assert isinstance(payload["env"], str)
