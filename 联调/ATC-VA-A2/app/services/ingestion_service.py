from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic
from typing import AsyncIterator

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import VoiceFile


class LiveATCIngestionService:
    """A-2 ingestion service skeleton for realtime and historical data pipelines."""

    HISTORICAL_NAME_PATTERN = re.compile(r"([A-Za-z]{3})-(\d{1,2})-(\d{4})-(\d{4})Z", re.IGNORECASE)

    def __init__(self, db: AsyncSession):
        self.db = db

    async def register_realtime_capture(
        self,
        *,
        file_name: str,
        file_path: str,
        start_time_utc: datetime,
        end_time_utc: datetime,
        source_url: str,
        file_size: int | None = None,
        duration_ms: int = 0,
    ) -> VoiceFile:
        record = VoiceFile(
            file_name=file_name,
            file_path=file_path,
            icao_code=settings.a2_icao_code,
            start_time_utc=start_time_utc,
            end_time_utc=end_time_utc,
            file_size=file_size,
            source_url=source_url,
            status=1,
            duration_ms=duration_ms,
            a3_process_status=0,
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def register_historical_capture(
        self,
        *,
        file_name: str,
        source_url: str,
        start_time_utc: datetime,
        end_time_utc: datetime,
        file_path: str | None = None,
        file_size: int | None = None,
        status: int = 1,
    ) -> VoiceFile:
        if file_path is None:
            storage_dir = Path(settings.a2_audio_storage)
            storage_dir.mkdir(parents=True, exist_ok=True)
            file_path = str(storage_dir / file_name)

        record = VoiceFile(
            file_name=file_name,
            file_path=file_path,
            icao_code=settings.a2_icao_code,
            start_time_utc=start_time_utc,
            end_time_utc=end_time_utc,
            source_url=source_url,
            file_size=file_size,
            status=status,
            a3_process_status=0,
            duration_ms=max(int((end_time_utc - start_time_utc).total_seconds() * 1000), 0),
        )
        self.db.add(record)
        await self.db.commit()
        await self.db.refresh(record)
        return record

    async def has_source_url(self, source_url: str) -> bool:
        stmt = select(VoiceFile.id).where(VoiceFile.source_url == source_url).limit(1)
        row = await self.db.execute(stmt)
        return row.scalar_one_or_none() is not None

    async def register_historical_download(
        self,
        *,
        file_name: str,
        source_url: str,
        byte_iter: AsyncIterator[bytes],
        now: datetime | None = None,
        parsed_start_time_utc: datetime | None = None,
        parsed_end_time_utc: datetime | None = None,
    ) -> VoiceFile | None:
        now_utc = now or self.utc_now()
        storage_dir = Path(settings.a2_audio_storage) / "historical" / now_utc.strftime("%Y%m%d")
        storage_dir.mkdir(parents=True, exist_ok=True)
        file_path = storage_dir / file_name

        written = 0

        def _open_file() -> object:
            return open(file_path, "wb")

        fp = await asyncio.to_thread(_open_file)
        failed = False
        try:
            async for chunk in byte_iter:
                if not chunk:
                    continue
                await asyncio.to_thread(fp.write, chunk)
                written += len(chunk)
        except Exception:
            failed = True
            raise
        finally:
            await asyncio.to_thread(fp.close)
            if failed:
                file_path.unlink(missing_ok=True)

        if written == 0:
            file_path.unlink(missing_ok=True)
            return None

        extracted = self.extract_utc_range_from_filename(file_name)
        start_time = parsed_start_time_utc or (extracted[0] if extracted else now_utc)
        end_time = parsed_end_time_utc or (extracted[1] if extracted else now_utc)

        return await self.register_historical_capture(
            file_name=file_name,
            source_url=source_url,
            start_time_utc=start_time,
            end_time_utc=end_time,
            file_path=str(file_path),
            file_size=written,
            status=1,
        )

    async def capture_realtime_stream(
        self,
        *,
        stream_url: str,
        timeout_seconds: int | None = None,
        max_bytes: int | None = None,
        request_headers: dict[str, str] | None = None,
        proxy: str | None = None,
    ) -> VoiceFile | None:
        capture_seconds = timeout_seconds or settings.a2_realtime_capture_seconds
        bytes_limit = max_bytes or settings.a2_realtime_capture_max_bytes
        now_utc = self.utc_now()
        now_local = now_utc.astimezone()
        storage_dir = Path(settings.a2_audio_storage) / "realtime" / now_local.strftime("%Y%m%d")
        storage_dir.mkdir(parents=True, exist_ok=True)
        file_name = (
            f"{settings.a2_icao_code.lower()}_"
            f"{now_local.strftime('%Y%m%d_%H%M%S')}.mp3"
        )
        output_path = storage_dir / file_name
        temp_path = output_path.with_name(f"{output_path.name}.part")

        timeout = httpx.Timeout(connect=10.0, read=10.0, write=10.0, pool=10.0)
        start_ts = monotonic()
        written = 0
        temp_path.unlink(missing_ok=True)
        try:
            with temp_path.open("wb") as f:
                client_kwargs = {"timeout": timeout, "headers": request_headers}
                if proxy:
                    client_kwargs["proxy"] = proxy
                async with httpx.AsyncClient(**client_kwargs) as client:
                    async with client.stream("GET", stream_url, follow_redirects=True) as resp:
                        resp.raise_for_status()
                        async for chunk in resp.aiter_bytes(chunk_size=8192):
                            if not chunk:
                                await asyncio.sleep(0)
                                continue
                            remaining = bytes_limit - written
                            if remaining <= 0:
                                break
                            data = chunk[:remaining]
                            f.write(data)
                            written += len(data)
                            elapsed = monotonic() - start_ts
                            if written >= bytes_limit or elapsed >= capture_seconds:
                                break
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise

        if written == 0:
            temp_path.unlink(missing_ok=True)
            return None
        try:
            temp_path.replace(output_path)
        except BaseException:
            temp_path.unlink(missing_ok=True)
            raise

        end_utc = self.utc_now()
        duration_ms = max(int((end_utc - now_utc).total_seconds() * 1000), 0)
        return await self.register_realtime_capture(
            file_name=file_name,
            file_path=str(output_path),
            start_time_utc=now_utc,
            end_time_utc=end_utc,
            source_url=stream_url,
            file_size=written,
            duration_ms=duration_ms,
        )

    @staticmethod
    def floor_to_half_hour(value: datetime) -> datetime:
        floored_minute = (value.minute // 30) * 30
        return value.replace(minute=floored_minute, second=0, microsecond=0)

    def estimate_realtime_segment_bounds(self, capture_start: datetime, capture_end: datetime) -> tuple[datetime, datetime]:
        elapsed = max((capture_end - capture_start).total_seconds(), 0)
        half_hour = settings.a2_realtime_half_hour_seconds
        if elapsed >= half_hour * 0.95:
            segment_start = self.floor_to_half_hour(capture_start)
            segment_end = segment_start + timedelta(seconds=half_hour)
            return segment_start, segment_end
        return capture_start, capture_end

    def extract_utc_range_from_filename(self, file_name: str) -> tuple[datetime, datetime] | None:
        matched = self.HISTORICAL_NAME_PATTERN.search(file_name)
        if not matched:
            return None
        month_text, day_text, year_text, hhmm_text = matched.groups()
        try:
            month = datetime.strptime(month_text[:3], "%b").month
            day = int(day_text)
            year = int(year_text)
            hour = int(hhmm_text[:2])
            minute = int(hhmm_text[2:])
            start = datetime(year, month, day, hour, minute, tzinfo=timezone.utc)
            end = start + timedelta(seconds=settings.a2_realtime_half_hour_seconds)
            return start, end
        except ValueError:
            return None

    @staticmethod
    def utc_now() -> datetime:
        return datetime.now(timezone.utc)
