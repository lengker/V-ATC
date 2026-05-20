from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_db():
    execute_result = MagicMock()
    execute_result.scalar_one_or_none.return_value = None
    scalars_result = MagicMock()
    scalars_result.all.return_value = []
    execute_result.scalars.return_value = scalars_result

    db = AsyncMock()
    db.add = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock(side_effect=lambda obj: setattr(obj, "id", 1))
    db.execute = AsyncMock(return_value=execute_result)
    db.get = AsyncMock(return_value=None)
    return db
