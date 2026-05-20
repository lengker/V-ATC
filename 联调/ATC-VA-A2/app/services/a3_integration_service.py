"""
A-3 Integration Service

Manages interaction with A-3 preprocessing module:
- Request triggering for preprocessing
- Status tracking and monitoring
- Retry logic with exponential backoff
- Segment annotation status synchronization
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from random import uniform

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import VoiceFile, VoiceSegment
from app.services.query_service import AudioQueryService

logger = logging.getLogger(__name__)


class A3IntegrationService:
    """Service for coordinating with A-3 preprocessing module."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.query_service = AudioQueryService(db)
        self.base_retry_delay = 2  # seconds
        self.max_retry_delay = 60  # seconds
        self.max_retries = 5

    async def request_processing(self, voice_file_id: int) -> dict:
        """
        Trigger A-3 preprocessing for a voice file.

        RQ-A-3-10 integration: Request A-3 to process a VoiceFile.
        """
        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        if voice_file.a3_process_status in (2, 3):  # Already processed or failed
            return {
                "voice_file_id": voice_file_id,
                "status": voice_file.a3_process_status,
                "message": "Processing already initiated or completed",
            }

        # Update status to "processing"
        voice_file.a3_process_status = 1
        self.db.add(voice_file)
        await self.db.commit()
        await self.db.refresh(voice_file)

        logger.info(f"A-3 processing requested for voice_file_id={voice_file_id} ({voice_file.file_name})")

        return {
            "voice_file_id": voice_file_id,
            "status": 1,
            "file_name": voice_file.file_name,
            "start_time_utc": voice_file.start_time_utc.isoformat(),
            "end_time_utc": voice_file.end_time_utc.isoformat(),
            "message": "Processing request sent to A-3 module",
        }

    async def get_processing_status(self, voice_file_id: int) -> dict:
        """
        Get current A-3 processing status for a voice file.

        RQ-A-3-30 integration: Query processing status.
        """
        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        status_map = {
            0: "not_started",
            1: "processing",
            2: "completed",
            3: "failed",
        }

        # Get segment count for this file
        stmt = select(VoiceSegment).where(VoiceSegment.voice_file_id == voice_file_id)
        result = await self.db.execute(stmt)
        segments = result.scalars().all()

        # Get annotated segment count
        annotated_count = sum(1 for seg in segments if seg.is_annotated)

        return {
            "voice_file_id": voice_file_id,
            "file_name": voice_file.file_name,
            "a3_process_status": voice_file.a3_process_status,
            "status_text": status_map.get(voice_file.a3_process_status, "unknown"),
            "segment_count": len(segments),
            "annotated_count": annotated_count,
            "error_log": voice_file.error_log,
            "updated_at": voice_file.updated_at.isoformat(),
        }

    async def retry_processing(self, voice_file_id: int, attempt: int = 0) -> dict:
        """
        Retry A-3 processing with exponential backoff.

        RQ-A-3-40 integration: Implement retry logic.
        """
        if attempt >= self.max_retries:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Max retry attempts ({self.max_retries}) exceeded")

        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        # Calculate backoff delay
        delay = min(self.base_retry_delay * (2 ** attempt) + uniform(0, self.base_retry_delay), self.max_retry_delay)

        logger.info(f"Retrying A-3 processing for voice_file_id={voice_file_id} (attempt {attempt + 1}/{self.max_retries}), delay={delay:.1f}s")

        # Wait before retrying
        await asyncio.sleep(delay)

        # Reset status to "processing"
        voice_file.a3_process_status = 1
        voice_file.error_log = None
        self.db.add(voice_file)
        await self.db.commit()
        await self.db.refresh(voice_file)

        return {
            "voice_file_id": voice_file_id,
            "attempt": attempt + 1,
            "delay_seconds": delay,
            "status": 1,
            "message": "Retry request submitted to A-3 module",
        }

    async def sync_annotation_status(self, voice_file_id: int) -> dict:
        """
        Synchronize segment annotation status from A-3 processing results.

        Marks segments as ready for annotation based on A-3 output completeness.
        """
        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        stmt = select(VoiceSegment).where(VoiceSegment.voice_file_id == voice_file_id)
        result = await self.db.execute(stmt)
        segments = result.scalars().all()

        # Count segments with ASR content (ready for annotation)
        ready_for_annotation = 0
        for segment in segments:
            if segment.asr_content and not segment.is_annotated:
                ready_for_annotation += 1

        logger.info(
            f"A-3 annotation sync for voice_file_id={voice_file_id}: "
            f"{ready_for_annotation}/{len(segments)} segments ready for annotation"
        )

        return {
            "voice_file_id": voice_file_id,
            "total_segments": len(segments),
            "ready_for_annotation": ready_for_annotation,
            "already_annotated": sum(1 for seg in segments if seg.is_annotated),
            "pending_asr": sum(1 for seg in segments if not seg.asr_content),
        }

    async def list_processing_queue(self, status_filter: int | None = None, limit: int = 20) -> dict:
        """
        List voice files in A-3 processing queue.

        Returns files ordered by creation time, optionally filtered by status.
        """
        query = select(VoiceFile)

        if status_filter is not None:
            query = query.where(VoiceFile.a3_process_status == status_filter)

        query = query.order_by(VoiceFile.created_at.desc()).limit(limit)

        result = await self.db.execute(query)
        files = result.scalars().all()

        status_map = {0: "not_started", 1: "processing", 2: "completed", 3: "failed"}

        return {
            "queue_size": len(files),
            "items": [
                {
                    "voice_file_id": f.id,
                    "file_name": f.file_name,
                    "a3_process_status": f.a3_process_status,
                    "status_text": status_map.get(f.a3_process_status, "unknown"),
                    "created_at": f.created_at.isoformat(),
                }
                for f in files
            ],
        }
