from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.ingestion_service import LiveATCIngestionService
from app.services.ingestion_scheduler import liveatc_scheduler

router = APIRouter(prefix="/api/v1/ingestion", tags=["ingestion"])


class RealtimeRegisterRequest(BaseModel):
    file_name: str
    file_path: str
    start_time_utc: datetime
    end_time_utc: datetime
    source_url: str
    file_size: int | None = None
    duration_ms: int = 0


class HistoricalRegisterRequest(BaseModel):
    file_name: str
    source_url: str
    start_time_utc: datetime
    end_time_utc: datetime
    file_path: str | None = None
    file_size: int | None = None


class HistoricalDownloadAtRequest(BaseModel):
    """UTC 时刻；将自动对齐到 LiveATC 30 分钟档。"""
    utc_datetime: datetime


class SchedulerActionResponse(BaseModel):
    ok: bool = True
    status: dict[str, str | bool | int | None]


@router.post("/realtime/register", status_code=status.HTTP_201_CREATED)
async def register_realtime_file(payload: RealtimeRegisterRequest, db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    svc = LiveATCIngestionService(db)
    row = await svc.register_realtime_capture(
        file_name=payload.file_name,
        file_path=payload.file_path,
        start_time_utc=payload.start_time_utc,
        end_time_utc=payload.end_time_utc,
        source_url=payload.source_url,
        file_size=payload.file_size,
        duration_ms=payload.duration_ms,
    )
    return {"voice_file_id": row.id}


@router.post("/historical/register", status_code=status.HTTP_201_CREATED)
async def register_historical_file(payload: HistoricalRegisterRequest, db: AsyncSession = Depends(get_db)) -> dict[str, int]:
    svc = LiveATCIngestionService(db)
    row = await svc.register_historical_capture(
        file_name=payload.file_name,
        source_url=payload.source_url,
        start_time_utc=payload.start_time_utc,
        end_time_utc=payload.end_time_utc,
        file_path=payload.file_path,
        file_size=payload.file_size,
    )
    return {"voice_file_id": row.id}


@router.post("/scheduler/start", response_model=SchedulerActionResponse)
async def start_scheduler() -> SchedulerActionResponse:
    await liveatc_scheduler.start()
    return SchedulerActionResponse(status=liveatc_scheduler.status())


@router.post("/scheduler/stop", response_model=SchedulerActionResponse)
async def stop_scheduler() -> SchedulerActionResponse:
    await liveatc_scheduler.stop()
    return SchedulerActionResponse(status=liveatc_scheduler.status())


@router.get("/scheduler/status")
async def scheduler_status() -> dict[str, str | bool | int | None]:
    return liveatc_scheduler.status()


@router.post("/scheduler/trigger/realtime")
async def trigger_realtime_once() -> dict[str, bool | str | None]:
    before = liveatc_scheduler.status().get("last_error")
    ok = await liveatc_scheduler.trigger_realtime_once()
    after = liveatc_scheduler.status().get("last_error")
    error = after if after != before else None
    return {"ok": ok, "error": error}


@router.post("/historical/download-at")
async def download_historical_at(payload: HistoricalDownloadAtRequest) -> dict[str, object]:
    """按指定 UTC 时刻下载一条 LiveATC 历史录音（30 分钟档）。"""
    return await liveatc_scheduler.download_historical_at(payload.utc_datetime)


@router.post("/scheduler/trigger/historical")
async def trigger_historical_once() -> dict[str, int | str | None]:
    before = liveatc_scheduler.status().get("last_error")
    downloaded = await liveatc_scheduler.trigger_historical_once()
    status_data = liveatc_scheduler.status()
    after = status_data.get("last_error")
    error = after if after != before else None
    return {
        "downloaded": downloaded,
        "error": error,
        "found": int(status_data.get("last_historical_found", 0) or 0),
        "skipped": int(status_data.get("last_historical_skipped", 0) or 0),
    }
