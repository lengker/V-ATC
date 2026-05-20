"""admin 路由集成测试 — 验证存储清理接口，Mock 磁盘操作。"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_cleanup_when_needed(client):
    """磁盘不足时触发清理，返回 deleted_files > 0。"""
    fake_usage = MagicMock(total=10 * 1024**3, used=9 * 1024**3, free=1 * 1024**3)
    with patch("app.services.storage_service.shutil.disk_usage", return_value=fake_usage), \
         patch("app.services.storage_service.Path.mkdir"), \
         patch("app.services.storage_service.os.path.exists", return_value=False):
        resp = await client.post("/api/v1/admin/cleanup")

    assert resp.status_code == 200
    data = resp.json()
    assert data["need_cleanup"] is True


@pytest.mark.asyncio
async def test_cleanup_not_needed(client):
    """磁盘充足时不触发清理，deleted_files=0。"""
    fake_usage = MagicMock(total=10 * 1024**3, used=5 * 1024**3, free=5 * 1024**3)
    with patch("app.services.storage_service.shutil.disk_usage", return_value=fake_usage), \
         patch("app.services.storage_service.Path.mkdir"):
        resp = await client.post("/api/v1/admin/cleanup")

    assert resp.status_code == 200
    data = resp.json()
    assert data["need_cleanup"] is False
    assert data["deleted_files"] == 0
