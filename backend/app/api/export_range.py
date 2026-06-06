from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from app.db.connection import get_connection
from app.services.utc_range_export import (
    build_export_zip,
    build_merge_for_player,
    build_visual_transcript,
)
from app.tables import lng_audio_records

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/audio-by-utc-range")
def list_audio_by_utc_range(
    start_utc: str = Query(..., description="区间起点 UTC ISO8601"),
    end_utc: str = Query(..., description="区间终点 UTC ISO8601"),
    limit: int = Query(500, ge=1, le=1000),
) -> dict[str, Any]:
    """查询与 [start_utc, end_utc) 有交集的 LNG_AUDIO_RECORDS。"""
    with get_connection() as conn:
        try:
            rows = lng_audio_records.list_by_utc_range(conn, start_utc, end_utc, limit=limit)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, "count": len(rows), "start_utc": start_utc, "end_utc": end_utc, "rows": rows}


@router.get("/audio-by-utc-range/transcript")
def transcript_by_utc_range(
    start_utc: str = Query(...),
    end_utc: str = Query(...),
) -> dict[str, Any]:
    with get_connection() as conn:
        try:
            start = lng_audio_records._parse_utc_text(start_utc)
            end = lng_audio_records._parse_utc_text(end_utc)
            if start is None or end is None:
                raise ValueError("时间格式无效")
            if end <= start:
                raise ValueError("end_utc 必须晚于 start_utc")
            rows = lng_audio_records.list_by_utc_range(conn, start_utc, end_utc)
            text = build_visual_transcript(conn, rows, range_start=start, range_end=end)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {
            "ok": True,
            "count": len(rows),
            "start_utc": start_utc,
            "end_utc": end_utc,
            "transcript": text,
            "has_recordings": len(rows) > 0,
        }


@router.post("/audio-by-utc-range/load")
def load_merged_by_utc_range(
    start_utc: str = Query(...),
    end_utc: str = Query(...),
    strategy: Literal["concat", "single_longest"] = Query("concat"),
) -> dict[str, Any]:
    """合并时段内录音并返回播放器载荷（audio_url + 对齐后的 timestamps）。"""
    with get_connection() as conn:
        try:
            return build_merge_for_player(
                conn, start_utc=start_utc, end_utc=end_utc, strategy=strategy
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio-by-utc-range/package")
def package_by_utc_range(
    start_utc: str = Query(...),
    end_utc: str = Query(...),
    strategy: Literal["concat", "single_longest"] = Query("concat"),
) -> Response:
    """ZIP：merged.mp3（可空）+ transcript-visual.txt + segments/ + manifest.json"""
    with get_connection() as conn:
        try:
            data, meta = build_export_zip(
                conn, start_utc=start_utc, end_utc=end_utc, strategy=strategy
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    safe_start = start_utc.replace(":", "").replace(".", "")[:15]
    safe_end = end_utc.replace(":", "").replace(".", "")[:15]
    filename = f"utc-range_{safe_start}_{safe_end}.zip"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "X-Export-Count": str(meta.get("count", 0)),
        "X-Export-Has-Audio": "1" if meta.get("has_audio") else "0",
    }
    return Response(content=data, media_type="application/zip", headers=headers)
