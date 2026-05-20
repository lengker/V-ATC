from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import AsyncGenerator

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import VoiceFile, VoiceSegment


class AudioQueryService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def find_segments(self, start_time: datetime, end_time: datetime) -> list[VoiceSegment]:
        query_start = start_time.replace(tzinfo=None) if start_time.tzinfo else start_time
        query_end = end_time.replace(tzinfo=None) if end_time.tzinfo else end_time
        stmt = select(VoiceSegment).where(
            and_(
                VoiceSegment.abs_start_time < query_end,
                VoiceSegment.abs_end_time > query_start,
            )
        ).order_by(VoiceSegment.abs_start_time.asc())
        return list((await self.db.execute(stmt)).scalars().all())

    async def get_voice_file(self, voice_file_id: int) -> VoiceFile | None:
        return await self.db.get(VoiceFile, voice_file_id)

    async def touch_last_access(self, file_record: VoiceFile) -> None:
        file_record.last_access_at = datetime.now(timezone.utc)
        self.db.add(file_record)
        await self.db.commit()

    async def iter_file_stream(self, file_path: str) -> AsyncGenerator[bytes, None]:
        chunk_size = settings.a2_chunk_size

        def _open_file() -> object:
            return open(file_path, "rb")

        fp = await asyncio.to_thread(_open_file)
        try:
            while True:
                data = await asyncio.to_thread(fp.read, chunk_size)
                if not data:
                    break
                yield data
        finally:
            await asyncio.to_thread(fp.close)

    @staticmethod
    def estimate_byte_range(
        *,
        duration_ms: int | None,
        file_size: int,
        relative_start_sec: float,
        relative_end_sec: float,
    ) -> tuple[int, int]:
        if duration_ms is None or duration_ms <= 0:
            return 0, file_size

        total_sec = duration_ms / 1000.0
        if total_sec <= 0:
            return 0, file_size

        start_ratio = max(min(relative_start_sec / total_sec, 1.0), 0.0)
        end_ratio = max(min(relative_end_sec / total_sec, 1.0), 0.0)
        if end_ratio <= start_ratio:
            return 0, 0

        start_byte = int(file_size * start_ratio)
        end_byte = int(file_size * end_ratio)
        if end_byte <= start_byte:
            end_byte = min(start_byte + settings.a2_chunk_size, file_size)
        return start_byte, end_byte

    async def iter_file_stream_range(
        self,
        *,
        file_path: str,
        start_byte: int,
        end_byte: int,
    ) -> AsyncGenerator[bytes, None]:
        chunk_size = settings.a2_chunk_size
        file_size = await asyncio.to_thread(os.path.getsize, file_path)
        bounded_start = max(min(start_byte, file_size), 0)
        bounded_end = max(min(end_byte, file_size), bounded_start)

        def _open_file() -> object:
            return open(file_path, "rb")

        fp = await asyncio.to_thread(_open_file)
        try:
            await asyncio.to_thread(fp.seek, bounded_start)
            remaining = bounded_end - bounded_start
            while remaining > 0:
                to_read = min(chunk_size, remaining)
                data = await asyncio.to_thread(fp.read, to_read)
                if not data:
                    break
                remaining -= len(data)
                yield data
        finally:
            await asyncio.to_thread(fp.close)
