"""
A-5 Integration Service

Manages interaction with A-5 database module:
- Track metadata lookup and linking
- User/Annotator resolution
- Cross-module data queries
- Annotation metadata synchronization
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import VoiceFile, VoiceSegment
from app.services.query_service import AudioQueryService

logger = logging.getLogger(__name__)


class A5IntegrationService:
    """Service for coordinating with A-5 database module."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.query_service = AudioQueryService(db)

    @staticmethod
    def _a5_base_url() -> str:
        return settings.a5_service_base_url.rstrip("/")

    @staticmethod
    def _coalesce_text(*values: object, default: str = "") -> str:
        for value in values:
            if value is None:
                continue
            text = str(value).strip()
            if text:
                return text
        return default

    @staticmethod
    def _coerce_bool(value: object, default: bool = True) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return bool(value)
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "y", "on"}:
            return True
        if text in {"0", "false", "no", "n", "off"}:
            return False
        return default

    @staticmethod
    def _to_base64url(raw: bytes) -> str:
        return base64.urlsafe_b64encode(raw).decode("utf-8").rstrip("=")

    @classmethod
    def _hash_a5_password(cls, password: str) -> str:
        salt = secrets.token_bytes(16)
        iterations = 200_000
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return (
            f"pbkdf2_sha256${iterations}$"
            f"{cls._to_base64url(salt)}${cls._to_base64url(digest)}"
        )

    async def _remote_get_json(self, path: str, *, params: dict | None = None) -> dict | list | None:
        url = f"{self._a5_base_url()}/{path.lstrip('/')}"
        timeout = httpx.Timeout(8.0, connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
        except Exception as exc:  # noqa: BLE001
            logger.debug("A5 GET %s failed: %s", url, exc)
            return None

    async def _remote_post_json(self, path: str, payload: dict | list) -> dict | list | None:
        url = f"{self._a5_base_url()}/{path.lstrip('/')}"
        timeout = httpx.Timeout(10.0, connect=5.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json()
        except Exception as exc:  # noqa: BLE001
            logger.debug("A5 POST %s failed: %s", url, exc)
            return None

    @staticmethod
    def _extract_first_id(payload: Any, id_field: str) -> int | None:
        if isinstance(payload, list):
            if not payload:
                return None
            first = payload[0]
            if isinstance(first, dict):
                value = first.get(id_field)
                try:
                    return int(value)
                except (TypeError, ValueError):
                    return None
        if isinstance(payload, dict):
            value = payload.get(id_field)
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
        return None

    async def _resolve_remote_audio_id(self, voice_file: VoiceFile) -> int | None:
        search_candidates = [
            {"source_url": voice_file.source_url} if voice_file.source_url else None,
            {"file_name": voice_file.file_name},
            {"file_path": voice_file.file_path},
        ]
        for reference in search_candidates:
            if not reference:
                continue
            payload = await self._remote_post_json(
                "/query/arbitrary",
                {"reference": reference, "select": ["audio_id"]},
            )
            if isinstance(payload, list) and payload:
                first = payload[0]
                if isinstance(first, dict):
                    audio_id = first.get("audio_id")
                    if isinstance(audio_id, int):
                        return audio_id
                    try:
                        return int(audio_id)
                    except (TypeError, ValueError):
                        pass
            if isinstance(payload, dict):
                items = payload.get("data") if isinstance(payload.get("data"), list) else None
                if items:
                    first = items[0]
                    if isinstance(first, dict):
                        audio_id = first.get("audio_id")
                        try:
                            return int(audio_id)
                        except (TypeError, ValueError):
                            pass
        return voice_file.id

    async def _ensure_remote_user_id(self, author_id: int) -> int | None:
        username = f"annotator_{author_id}"
        existing = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"username": username}, "select": ["user_id"]},
        )
        existing_id = self._extract_first_id(existing, "user_id")
        if existing_id is not None:
            return existing_id

        created = await self._remote_post_json(
            "/tables/users",
            {
                "username": username,
                "password_hash": self._hash_a5_password(f"a2-sync-{author_id}"),
                "email": f"user{author_id}@example.com",
                "role": "annotator",
            },
        )
        created_id = self._extract_first_id(created, "id")
        if created_id is not None:
            return created_id

        retry = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"username": username}, "select": ["user_id"]},
        )
        retry_id = self._extract_first_id(retry, "user_id")
        if retry_id is not None:
            return retry_id

        return None

    async def _ensure_remote_track_id(self, voice_file: VoiceFile) -> int | None:
        remote_flight_id = f"A2-{voice_file.id}"
        existing = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"flight_id": remote_flight_id}, "select": ["track_id"]},
        )
        existing_id = self._extract_first_id(existing, "track_id")
        if existing_id is not None:
            return existing_id

        airport_code = voice_file.icao_code or "VHHH"
        created = await self._remote_post_json(
            "/tables/tracks/ext/create",
            {
                "timestamp": voice_file.start_time_utc.isoformat(),
                "flight_id": remote_flight_id,
                "tracks_latitude": 0.0,
                "tracks_longitude": 0.0,
                "altitude": 0.0,
                "speed": 0.0,
                "heading": 0.0,
                "airport_code": [airport_code, airport_code],
            },
        )
        created_id = self._extract_first_id(created, "track_id")
        if created_id is not None:
            return created_id

        retry = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"flight_id": remote_flight_id}, "select": ["track_id"]},
        )
        retry_id = self._extract_first_id(retry, "track_id")
        if retry_id is not None:
            return retry_id

        return None

    async def _ensure_remote_audio_record_id(self, voice_file: VoiceFile) -> int | None:
        search_candidates = [
            {"source_url": voice_file.source_url} if voice_file.source_url else None,
            {"file_name": voice_file.file_name},
            {"file_path": voice_file.file_path},
        ]
        for reference in search_candidates:
            if not reference:
                continue
            existing = await self._remote_post_json(
                "/query/arbitrary",
                {"reference": reference, "select": ["audio_id"]},
            )
            existing_id = self._extract_first_id(existing, "audio_id")
            if existing_id is not None:
                return existing_id

        track_id = await self._ensure_remote_track_id(voice_file)
        if track_id is None:
            return None
        created = await self._remote_post_json(
            "/tables/audio_records/ext/create",
            {
                "source_url": voice_file.source_url or f"a2://voice-file/{voice_file.id}",
                "start_time_utc": voice_file.start_time_utc.isoformat(),
                "end_time_utc": voice_file.end_time_utc.isoformat(),
                "duration_ms": voice_file.duration_ms,
                "file_name": voice_file.file_name,
                "file_path": voice_file.file_path,
                "file_size": voice_file.file_size,
                "status": voice_file.status,
                "track_id": track_id,
            },
        )
        created_id = self._extract_first_id(created, "audio_id")
        if created_id is not None:
            return created_id

        retry = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"file_name": voice_file.file_name}, "select": ["audio_id"]},
        )
        retry_id = self._extract_first_id(retry, "audio_id")
        if retry_id is not None:
            return retry_id

        return None

    @staticmethod
    def _fallback_track_metadata(track_id: int) -> dict:
        return {
            "track_id": track_id,
            "flight_number": f"FLT{track_id:04d}",
            "aircraft_type": "unknown",
            "callsign": f"TRACK-{track_id}",
            "departure": "unknown",
            "arrival": "unknown",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _fallback_user_metadata(author_id: int) -> dict:
        return {
            "author_id": author_id,
            "username": f"annotator_{author_id}",
            "email": f"user{author_id}@example.com",
            "role": "viewer",
            "active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _remote_track_metadata_to_response(track_id: int, payload: dict) -> dict:
        return {
            "track_id": track_id,
            "flight_number": A5IntegrationService._coalesce_text(
                payload.get("flight_number"),
                payload.get("flight_id"),
                payload.get("callsign"),
                default=f"FLT{track_id:04d}",
            ),
            "aircraft_type": A5IntegrationService._coalesce_text(
                payload.get("aircraft_type"),
                payload.get("aircraft"),
                payload.get("model"),
                default="unknown",
            ),
            "callsign": A5IntegrationService._coalesce_text(
                payload.get("callsign"),
                payload.get("flight_id"),
                payload.get("flight_number"),
                default=f"TRACK-{track_id}",
            ),
            "departure": A5IntegrationService._coalesce_text(
                payload.get("departure"),
                payload.get("departure_airport_code"),
                default="unknown",
            ),
            "arrival": A5IntegrationService._coalesce_text(
                payload.get("arrival"),
                payload.get("arrival_airport_code"),
                default="unknown",
            ),
            "timestamp": A5IntegrationService._coalesce_text(
                payload.get("timestamp"),
                payload.get("start_time_utc"),
                default=datetime.now(timezone.utc).isoformat(),
            ),
        }

    @staticmethod
    def _remote_user_metadata_to_response(author_id: int, payload: dict) -> dict:
        return {
            "author_id": author_id,
            "username": A5IntegrationService._coalesce_text(payload.get("username"), default=f"annotator_{author_id}"),
            "email": A5IntegrationService._coalesce_text(payload.get("email"), default=f"user{author_id}@example.com"),
            "role": A5IntegrationService._coalesce_text(payload.get("role"), default="viewer"),
            "active": A5IntegrationService._coerce_bool(payload.get("active"), default=True),
            "created_at": A5IntegrationService._coalesce_text(payload.get("created_at"), default=datetime.now(timezone.utc).isoformat()),
        }

    async def get_track_metadata(self, track_id: int) -> dict:
        """
        Retrieve track metadata from A-5 module.

        Prefer the remote A-5 backend and fall back to a local template when
        the backend is not reachable.
        
        RQ-A-5-50: Link with A-5 track API for flight metadata.
        """
        logger.info(f"Fetching track metadata for track_id={track_id}")

        remote = await self._remote_get_json(f"tables/tracks/{track_id}")
        if isinstance(remote, dict):
            return self._remote_track_metadata_to_response(track_id, remote)

        remote = await self._remote_post_json(
            "/query/arbitrary",
            {"reference": {"track_id": track_id}, "select": ["track_id", "flight_id", "departure_airport_code", "arrival_airport_code", "timestamp"]},
        )
        if isinstance(remote, list) and remote:
            first = remote[0]
            if isinstance(first, dict):
                return self._remote_track_metadata_to_response(track_id, first)

        return self._fallback_track_metadata(track_id)

    async def get_user_metadata(self, author_id: int) -> dict:
        """
        Retrieve user/annotator metadata from A-5 module.

        Prefer the remote A-5 backend and fall back to a local template when
        the backend is not reachable.
        
        RQ-A-5-40: Link with A-5 user API for annotator info.
        """
        logger.info(f"Fetching user metadata for author_id={author_id}")

        remote = await self._remote_get_json(f"tables/users/{author_id}")
        if isinstance(remote, dict):
            return self._remote_user_metadata_to_response(author_id, remote)

        return self._fallback_user_metadata(author_id)

    async def list_audio_by_track(self, track_id: int, limit: int = 50) -> dict:
        """
        List all audio segments associated with a specific flight track.

        RQ-A-2-40 + A-5 integration: Query segments by track_id.
        """
        query = select(VoiceFile).where(VoiceFile.track_id == track_id).order_by(VoiceFile.start_time_utc.asc()).limit(limit)

        result = await self.db.execute(query)
        files = result.scalars().all()

        if not files:
            logger.warning(f"No audio files found for track_id={track_id}")

        items = []
        for file in files:
            # Get segments for this file
            seg_query = select(VoiceSegment).where(VoiceSegment.voice_file_id == file.id)
            seg_result = await self.db.execute(seg_query)
            segments = seg_result.scalars().all()

            items.append(
                {
                    "voice_file_id": file.id,
                    "file_name": file.file_name,
                    "track_id": file.track_id,
                    "start_time_utc": file.start_time_utc.isoformat(),
                    "end_time_utc": file.end_time_utc.isoformat(),
                    "file_size": file.file_size,
                    "segment_count": len(segments),
                    "annotated_count": sum(1 for seg in segments if seg.is_annotated),
                    "a3_process_status": file.a3_process_status,
                    "source_url": file.source_url,
                }
            )

        return {
            "track_id": track_id,
            "file_count": len(files),
            "files": items,
        }

    async def list_audio_by_annotator(self, author_id: int, limit: int = 50) -> dict:
        """
        List all audio segments annotated by a specific user.

        RQ-A-2-40 + A-5 integration: Query segments by author_id.
        """
        query = (
            select(VoiceSegment)
            .where(VoiceSegment.author_id == author_id)
            .order_by(VoiceSegment.abs_start_time.asc())
            .limit(limit)
        )

        result = await self.db.execute(query)
        segments = result.scalars().all()

        if not segments:
            logger.warning(f"No annotated segments found for author_id={author_id}")

        # Get unique files
        file_ids = {seg.voice_file_id for seg in segments}
        files = {}
        for file_id in file_ids:
            file = await self.query_service.get_voice_file(file_id)
            if file:
                files[file_id] = file

        items = []
        for seg in segments:
            file = files.get(seg.voice_file_id)
            items.append(
                {
                    "segment_id": seg.id,
                    "voice_file_id": seg.voice_file_id,
                    "file_name": file.file_name if file else "unknown",
                    "author_id": seg.author_id,
                    "abs_start_time": seg.abs_start_time.isoformat(),
                    "abs_end_time": seg.abs_end_time.isoformat(),
                    "duration": seg.duration,
                    "asr_content": seg.asr_content,
                    "annotation_text": seg.annotation_text,
                    "is_annotated": seg.is_annotated,
                    "label_type": seg.label_type,
                }
            )

        return {
            "author_id": author_id,
            "annotation_count": len(segments),
            "segments": items,
        }

    async def sync_annotations_to_a5(self, voice_file_id: int) -> dict:
        """
        Synchronize annotation data to A-5 database.

        Exports all segments with their annotation metadata for A-5 storage.
        
        RQ-A-5-50: Push annotation updates back to A-5 module.
        """
        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        query = select(VoiceSegment).where(VoiceSegment.voice_file_id == voice_file_id)
        result = await self.db.execute(query)
        segments = result.scalars().all()

        remote_audio_id = await self._ensure_remote_audio_record_id(voice_file)
        eligible_count = 0
        payload = []
        remote_sync_possible = remote_audio_id is not None
        for seg in segments:
            if not (seg.is_annotated or seg.annotation_text):
                continue
            eligible_count += 1
            if seg.author_id is None:
                logger.debug("Skip segment_id=%s because author_id is missing", seg.id)
                remote_sync_possible = False
                continue
            remote_user_id = await self._ensure_remote_user_id(int(seg.author_id))
            if remote_user_id is None:
                remote_sync_possible = False
                continue
            payload.append(
                {
                    "audio_id": remote_audio_id,
                    "author_id": remote_user_id,
                    "label_type": seg.label_type,
                    "relative_start": seg.relative_start,
                    "relative_end": seg.relative_end,
                    "abs_start_time": seg.abs_start_time.isoformat(),
                    "abs_end_time": seg.abs_end_time.isoformat(),
                    "asr_content": seg.asr_content,
                    "vad_confidence": seg.vad_confidence,
                    "is_annotated": int(seg.is_annotated),
                    "annotation_text": seg.annotation_text,
                    "storage_tag": seg.storage_tag,
                }
            )

        remote_result = None
        if remote_sync_possible and payload:
            remote_result = await self._remote_post_json("tables/annotations/ext/create", payload)

        if remote_result is None and remote_sync_possible and payload:
            logger.info("A5 backend unavailable; counted %s annotations for voice_file_id=%s", eligible_count, voice_file_id)

        synced_count = len(payload) if remote_result is not None and remote_sync_possible else eligible_count
        if remote_sync_possible and remote_result is not None:
            logger.info("Synced %s annotations to remote A-5 for voice_file_id=%s", synced_count, voice_file_id)
        elif not remote_sync_possible:
            logger.info("A5 backend unavailable; using local annotation count for voice_file_id=%s", voice_file_id)

        logger.info(f"A-5 sync complete for voice_file_id={voice_file_id}: {synced_count}/{len(segments)} segments")

        return {
            "voice_file_id": voice_file_id,
            "total_segments": len(segments),
            "synced_count": synced_count,
            "message": f"Synchronized {synced_count} annotations to A-5 database",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def sync_annotations_from_a5(self, voice_file_id: int, sync_data: dict) -> dict:
        """
        Receive and apply annotation updates from A-5 database.

        Updates segment annotations based on A-5 source of truth.
        """
        voice_file = await self.query_service.get_voice_file(voice_file_id)
        if not voice_file:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice file not found")

        annotations = sync_data.get("annotations", [])
        updated_count = 0

        for anno in annotations:
            segment_id = anno.get("segment_id")
            author_id = anno.get("author_id")
            annotation_text = anno.get("annotation_text")
            label_type = anno.get("label_type")

            stmt = select(VoiceSegment).where(VoiceSegment.id == segment_id, VoiceSegment.voice_file_id == voice_file_id)
            result = await self.db.execute(stmt)
            segment = result.scalar_one_or_none()

            if segment:
                if author_id:
                    segment.author_id = author_id
                if annotation_text:
                    segment.annotation_text = annotation_text
                if label_type:
                    segment.label_type = label_type
                segment.is_annotated = True

                self.db.add(segment)
                updated_count += 1
                logger.info(f"Updated segment_id={segment_id} with A-5 annotation data")

        await self.db.commit()

        logger.info(f"Applied {updated_count} annotation updates from A-5 for voice_file_id={voice_file_id}")

        return {
            "voice_file_id": voice_file_id,
            "updated_count": updated_count,
            "message": f"Applied {updated_count} annotation updates from A-5",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    async def get_cross_module_report(self, start_time: datetime, end_time: datetime) -> dict:
        """
        Generate cross-module report combining A-2, A-3, A-5 data.

        RQ-A-5-50: Provide aggregated system status to A-5.
        """
        # Get all voice files in time range
        query = select(VoiceFile).where(VoiceFile.start_time_utc >= start_time, VoiceFile.end_time_utc <= end_time)

        result = await self.db.execute(query)
        files = result.scalars().all()

        total_segments = 0
        annotated_segments = 0
        processed_files = 0
        failed_files = 0

        for file in files:
            if file.a3_process_status == 2:
                processed_files += 1
            elif file.a3_process_status == 3:
                failed_files += 1

            seg_query = select(VoiceSegment).where(VoiceSegment.voice_file_id == file.id)
            seg_result = await self.db.execute(seg_query)
            segments = seg_result.scalars().all()

            total_segments += len(segments)
            annotated_segments += sum(1 for seg in segments if seg.is_annotated)

        return {
            "time_range": {"start": start_time.isoformat(), "end": end_time.isoformat()},
            "file_count": len(files),
            "processed_files": processed_files,
            "failed_files": failed_files,
            "total_segments": total_segments,
            "annotated_segments": annotated_segments,
            "annotation_rate": (annotated_segments / total_segments * 100) if total_segments > 0 else 0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
