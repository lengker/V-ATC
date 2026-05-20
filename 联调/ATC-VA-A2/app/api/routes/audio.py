from datetime import datetime, timezone
import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.query_service import AudioQueryService

router = APIRouter(prefix="/api/v1/audio", tags=["audio"])


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@router.get("/stream", summary="Stream audio by UTC range")
async def stream_audio(
    start_time_utc: datetime = Query(...),
    end_time_utc: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    start_time_utc = _as_utc(start_time_utc)
    end_time_utc = _as_utc(end_time_utc)

    if end_time_utc <= start_time_utc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_time_utc must be after start_time_utc")

    svc = AudioQueryService(db)
    segments = await svc.find_segments(start_time_utc, end_time_utc)
    if not segments:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No audio segment found in range")

    segment = segments[0]
    voice_file = await svc.get_voice_file(segment.voice_file_id)
    if not voice_file:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source file not found")
    if not os.path.exists(voice_file.file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source file does not exist")

    seg_abs_start = _as_utc(segment.abs_start_time)
    seg_abs_end = _as_utc(segment.abs_end_time)
    file_abs_start = _as_utc(voice_file.start_time_utc)

    overlap_start = max(start_time_utc, seg_abs_start)
    overlap_end = min(end_time_utc, seg_abs_end)
    if overlap_end <= overlap_start:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No overlapped segment found")

    relative_start = max((overlap_start - file_abs_start).total_seconds(), 0.0)
    relative_end = max((overlap_end - file_abs_start).total_seconds(), 0.0)

    file_size = int(voice_file.file_size or 0)
    if file_size <= 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source file size is invalid")

    start_byte, end_byte = svc.estimate_byte_range(
        duration_ms=voice_file.duration_ms,
        file_size=file_size,
        relative_start_sec=relative_start,
        relative_end_sec=relative_end,
    )
    if end_byte <= start_byte:
        raise HTTPException(status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, detail="Invalid byte range")

    await svc.touch_last_access(voice_file)
    stream = svc.iter_file_stream_range(file_path=voice_file.file_path, start_byte=start_byte, end_byte=end_byte)

    headers = {
        "X-Voice-File-Id": str(voice_file.id),
        "X-Segment-Id": str(segment.id),
        "X-Relative-Start": f"{relative_start:.3f}",
        "X-Relative-End": f"{relative_end:.3f}",
        "Content-Length": str(end_byte - start_byte),
        "Content-Range": f"bytes {start_byte}-{end_byte - 1}/{file_size}",
    }
    return StreamingResponse(stream, media_type="audio/mpeg", headers=headers, status_code=status.HTTP_206_PARTIAL_CONTENT)
