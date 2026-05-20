from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path

from sqlalchemy import case, exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import StorageLog, VoiceFile, VoiceSegment


class StorageManagerService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_storage_usage(self) -> dict[str, int]:
        storage_dir = Path(settings.a2_audio_storage)
        storage_dir.mkdir(parents=True, exist_ok=True)
        usage = shutil.disk_usage(storage_dir)
        return {"total": usage.total, "used": usage.used, "free": usage.free}

    async def needs_cleanup(self) -> bool:
        usage = await self.get_storage_usage()
        return usage["free"] < settings.a2_disk_safe_free_bytes

    async def ensure_capacity_for_new_download(self, max_delete: int = 20) -> bool:
        if not await self.needs_cleanup():
            return True
        await self.cleanup_lru_files(max_delete=max_delete)
        return not await self.needs_cleanup()

    async def cleanup_lru_files(self, max_delete: int = 10) -> int:
        has_annotated_expr = exists(
            select(VoiceSegment.id).where(
                VoiceSegment.voice_file_id == VoiceFile.id,
                VoiceSegment.is_annotated.is_(True),
            )
        )
        stmt = (
            select(VoiceFile)
            .where(VoiceFile.status.in_([0, 1, 2]))
            .order_by(
                case((VoiceFile.status == 2, 0), else_=1),
                case((has_annotated_expr, 0), else_=1),
                VoiceFile.last_access_at.asc(),
                VoiceFile.created_at.asc(),
            )
            .limit(max_delete)
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        deleted_count = 0

        for row in rows:
            released = 0
            try:
                if row.file_path and os.path.exists(row.file_path):
                    stat = os.stat(row.file_path)
                    released = stat.st_size
                    await asyncio.to_thread(os.remove, row.file_path)
                row.status = 3
                self.db.add(StorageLog(action_type="CLEANUP", target_file_id=row.id, released_space=released))
                deleted_count += 1
            except OSError:
                continue

        if deleted_count:
            await self.db.commit()
        return deleted_count
