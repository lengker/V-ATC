"""全局测试配置：内存数据库引擎、AsyncSession fixture、FastAPI 依赖重写。"""
from __future__ import annotations

from collections.abc import Callable, Generator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
pytest_plugins = [
    "tests.fixtures.api",
    "tests.fixtures.database",
    "tests.fixtures.external_services",
]


@pytest.fixture
def override_settings() -> Generator[Callable[..., None], None, None]:
    original: dict[str, object] = {}

    def _apply(**kwargs: object) -> None:
        for key, value in kwargs.items():
            if key not in original:
                original[key] = getattr(settings, key)
            setattr(settings, key, value)

    yield _apply

    for key, value in original.items():
        setattr(settings, key, value)


@pytest.fixture
def tmp_audio_storage(tmp_path, override_settings):
    storage = tmp_path / "audio"
    storage.mkdir(parents=True, exist_ok=True)
    override_settings(a2_audio_storage=str(storage))
    return storage


@pytest_asyncio.fixture(scope="function")
async def engine():
    _engine = create_async_engine(TEST_DB_URL, future=True)
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield _engine
    await _engine.dispose()


@pytest_asyncio.fixture
async def db_session(engine):
    factory = async_sessionmaker(engine, autoflush=False, autocommit=False, expire_on_commit=False)
    async with factory() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession, override_settings):
    override_settings(a2_auto_start_scheduler=False)

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
