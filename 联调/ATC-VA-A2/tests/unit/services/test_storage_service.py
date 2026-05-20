"""StorageManagerService 单元测试 — 完全隔离磁盘 IO 和数据库操作。"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.storage_service import StorageManagerService

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_needs_cleanup_true(mock_db):
    """磁盘剩余空间不足时 needs_cleanup 返回 True。"""
    svc = StorageManagerService(mock_db)
    fake_usage = MagicMock(total=10 * 1024**3, used=9 * 1024**3, free=1 * 1024**3)
    with patch("app.services.storage_service.shutil.disk_usage", return_value=fake_usage), \
         patch("app.services.storage_service.Path.mkdir"):
        result = await svc.needs_cleanup()
    assert result is True


@pytest.mark.asyncio
async def test_needs_cleanup_false(mock_db):
    """磁盘剩余空间充足时 needs_cleanup 返回 False。"""
    svc = StorageManagerService(mock_db)
    fake_usage = MagicMock(total=10 * 1024**3, used=5 * 1024**3, free=5 * 1024**3)
    with patch("app.services.storage_service.shutil.disk_usage", return_value=fake_usage), \
         patch("app.services.storage_service.Path.mkdir"):
        result = await svc.needs_cleanup()
    assert result is False


@pytest.mark.asyncio
async def test_cleanup_lru_skips_locked_file(mock_db):
    """os.remove 抛出 OSError 时，cleanup_lru_files 应跳过该文件并继续处理后续文件。"""
    row1 = MagicMock(id=1, file_path="/audio/a.mp3", status=0)
    row2 = MagicMock(id=2, file_path="/audio/b.mp3", status=0)

    scalars_mock = MagicMock()
    scalars_mock.all.return_value = [row1, row2]
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_mock
    mock_db.execute.return_value = execute_result

    svc = StorageManagerService(mock_db)

    with patch("app.services.storage_service.os.path.exists", return_value=True), \
         patch("app.services.storage_service.os.stat", return_value=MagicMock(st_size=1024)), \
         patch("app.services.storage_service.asyncio.to_thread", side_effect=[OSError("locked"), None]):
        deleted = await svc.cleanup_lru_files(max_delete=2)

    # row1 被锁定跳过，row2 成功删除
    assert deleted == 1


@pytest.mark.asyncio
async def test_cleanup_lru_no_files(mock_db):
    """没有可清理文件时返回 0，不调用 commit。"""
    scalars_mock = MagicMock()
    scalars_mock.all.return_value = []
    execute_result = MagicMock()
    execute_result.scalars.return_value = scalars_mock
    mock_db.execute.return_value = execute_result

    svc = StorageManagerService(mock_db)
    deleted = await svc.cleanup_lru_files()

    assert deleted == 0
    mock_db.commit.assert_not_called()
