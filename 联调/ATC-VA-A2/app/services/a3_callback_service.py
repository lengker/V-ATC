from __future__ import annotations

from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VoiceSegment
from app.schemas.callback import A3CallbackRequest, A3CallbackResponse
from app.services.query_service import AudioQueryService


class A3CallbackService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.query_service = AudioQueryService(db)

    async def handle_callback(self, payload: A3CallbackRequest) -> A3CallbackResponse:
        voice_file = await self.query_service.get_voice_file(payload.voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        voice_file.a3_process_status = payload.process_status
        voice_file.error_log = payload.error_log

        upserted = 0
        for seg in payload.segments:
            abs_start = voice_file.start_time_utc + timedelta(seconds=seg.relative_start)
            abs_end = voice_file.start_time_utc + timedelta(seconds=seg.relative_end)
            if abs_end <= abs_start:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid segment range")
            duration = max(seg.relative_end - seg.relative_start, 0)

            stmt = select(VoiceSegment).where(
                VoiceSegment.voice_file_id == voice_file.id,
                VoiceSegment.relative_start == seg.relative_start,
                VoiceSegment.relative_end == seg.relative_end,
            )
            existing = (await self.db.execute(stmt)).scalar_one_or_none()
            if existing:
                existing.abs_start_time = abs_start
                existing.abs_end_time = abs_end
                existing.asr_content = seg.asr_content
                existing.vad_confidence = seg.vad_confidence
                existing.duration = duration
                existing.model_info = seg.model_info
                existing.storage_tag = seg.storage_tag
                self.db.add(existing)
            else:
                item = VoiceSegment(
                    voice_file_id=voice_file.id,
                    relative_start=seg.relative_start,
                    relative_end=seg.relative_end,
                    abs_start_time=abs_start,
                    abs_end_time=abs_end,
                    asr_content=seg.asr_content,
                    vad_confidence=seg.vad_confidence,
                    duration=duration,
                    model_info=seg.model_info,
                    storage_tag=seg.storage_tag,
                    is_annotated=False,
                )
                self.db.add(item)
            upserted += 1

        await self.db.commit()
        await self.db.refresh(voice_file)

        return A3CallbackResponse(
            voice_file_id=voice_file.id,
            updated_at=voice_file.updated_at,
            segment_count=upserted,
        )
