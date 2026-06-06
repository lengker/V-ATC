from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
import math

from pydantic import BaseModel, field_validator

from app.db.connection import get_connection
from app.services.audio_timestamp_correction import apply_correction, estimate_correction
from app.tables import lng_audio_records

router = APIRouter(prefix="/sync", tags=["sync"])


class ApplyCorrectionBody(BaseModel):
    start_time_utc: str
    end_time_utc: str
    annotation_shift_sec: float = 0.0
    shift_annotations: bool = False

    @field_validator("annotation_shift_sec", mode="before")
    @classmethod
    def _coerce_annotation_shift(cls, value: object) -> float:
        if value is None:
            return 0.0
        try:
            n = float(value)
        except (TypeError, ValueError):
            return 0.0
        return 0.0 if not math.isfinite(n) else n


@router.post("/correct-audio-timestamp")
def correct_audio_timestamp(
    audio_id: int = Query(..., ge=1),
    apply: bool = Query(True, description="true=写回 A5；false=仅预估"),
    shift_annotations: bool = Query(False, description="是否同步平移 relative_start/end"),
) -> dict[str, Any]:
    """多源融合修正录音 start/end_time_utc（文件名·航迹·转写呼号）。"""
    with get_connection() as conn:
        row = lng_audio_records.get_item(conn, audio_id)
        if row is None:
            raise HTTPException(status_code=404, detail="录音不存在")

        ann_rows = conn.execute(
            """
            SELECT annotation_id, audio_id, relative_start, relative_end,
                   annotation_text, asr_content, label_type
            FROM LNG_ANNOTATIONS WHERE audio_id = ?
            ORDER BY relative_start
            """,
            (audio_id,),
        ).fetchall()
        annotations = [dict(r) for r in ann_rows]

        estimate = estimate_correction(conn, dict(row), annotations)
        if not apply:
            return {**estimate, "applied": False}

        apply_correction(
            conn,
            audio_id,
            estimate,
            shift_annotations=shift_annotations,
        )
        return {**estimate, "applied": True}


@router.post("/correct-audio-timestamp/apply")
def apply_audio_timestamp_correction(
    body: ApplyCorrectionBody = Body(...),
    audio_id: int = Query(..., ge=1),
) -> dict[str, Any]:
    """应用前端计算的修正结果。"""
    with get_connection() as conn:
        if lng_audio_records.get_item(conn, audio_id) is None:
            raise HTTPException(status_code=404, detail="录音不存在")
        payload = {
            "start_time_utc": body.start_time_utc,
            "end_time_utc": body.end_time_utc,
            "annotation_shift_sec": body.annotation_shift_sec,
        }
        meta = apply_correction(
            conn,
            audio_id,
            payload,
            shift_annotations=body.shift_annotations,
        )
        return {"ok": True, **meta, "estimate": payload}
