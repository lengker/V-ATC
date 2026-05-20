from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import settings
from app.db.base import Base


async def init_database(engine: AsyncEngine) -> None:
    Path(settings.a2_audio_storage).mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
