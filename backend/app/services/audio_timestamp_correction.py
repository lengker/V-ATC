"""录音 UTC 时间戳修正（文件名 + 航迹窗口 + 转写呼号）。"""
from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

UTC = timezone.utc

_LIVEATC_SLOT = re.compile(
    r"([A-Za-z]{3})-(\d{1,2})-(\d{4})-(\d{4})Z", re.IGNORECASE
)
_HKT_SHIFT = timedelta(hours=8)
_CALLSIGN = re.compile(
    r"\b([A-Z]{3}\d{1,4}[A-Z]?|CCA\d+|CPA\d+|CSN\d+|CRK\d+|HKE\d+)\b",
    re.IGNORECASE,
)


def _parse_utc(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}", s) and not re.search(
        r"[zZ]$|[+-]\d{2}:?\d{2}$", s
    ):
        s = s.replace(" ", "T") + ("Z" if "T" in s else "Z")
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _parse_filename_start(file_name: str) -> datetime | None:
    matched = _LIVEATC_SLOT.search(file_name)
    if not matched:
        return None
    month_text, day_text, year_text, hhmm_text = matched.groups()
    try:
        month = datetime.strptime(month_text[:3], "%b").month
        return datetime(
            int(year_text),
            month,
            int(day_text),
            int(hhmm_text[:2]),
            int(hhmm_text[2:]),
            tzinfo=UTC,
        )
    except ValueError:
        return None


def _tracks_in_window(
    conn: sqlite3.Connection, start: datetime, end: datetime, limit: int = 50_000
) -> list[sqlite3.Row]:
    start_s = start.isoformat()
    end_s = end.isoformat()
    return conn.execute(
        """
        SELECT track_id, timestamp, flight_id, tracks_latitude, tracks_longitude
        FROM LNG_TRACKS
        WHERE timestamp >= ? AND timestamp <= ?
          AND tracks_latitude BETWEEN 20 AND 24
          AND tracks_longitude BETWEEN 112 AND 116
        ORDER BY timestamp
        LIMIT ?
        """,
        (start_s, end_s, limit),
    ).fetchall()


def _score_window(
    conn: sqlite3.Connection,
    win_start: datetime,
    duration_sec: float,
    annotations: list[dict[str, Any]],
) -> float:
    win_end = win_start + timedelta(seconds=max(1, duration_sec))
    rows = _tracks_in_window(conn, win_start - timedelta(minutes=2), win_end + timedelta(minutes=2))
    score = float(min(len(rows), 5000)) * 0.02

    by_flight: dict[str, list[float]] = {}
    for r in rows:
        fid = str(r["flight_id"] or "").strip().upper()
        if not fid:
            continue
        ts = _parse_utc(str(r["timestamp"]))
        if ts is None:
            continue
        by_flight.setdefault(fid, []).append(ts.timestamp())

    for ann in annotations:
        text = str(ann.get("annotation_text") or ann.get("asr_content") or "").upper()
        rel = float(ann.get("relative_start") or 0)
        expected = win_start.timestamp() + rel
        for m in _CALLSIGN.finditer(text):
            cs = m.group(1).upper()
            for fid, times in by_flight.items():
                if cs not in fid and fid not in cs:
                    continue
                for abs_ts in times:
                    if abs(abs_ts - expected) <= 90:
                        score += 20
                        break
    return score


def estimate_correction(
    conn: sqlite3.Connection,
    audio_row: dict[str, Any],
    annotations: list[dict[str, Any]],
) -> dict[str, Any]:
    file_name = str(audio_row.get("file_name") or "")
    duration_ms = int(audio_row.get("duration_ms") or 0) or 60_000
    duration_sec = max(1.0, duration_ms / 1000.0)

    prev_start = _parse_utc(str(audio_row.get("start_time_utc") or ""))
    prev_end = _parse_utc(str(audio_row.get("end_time_utc") or ""))

    candidates: list[tuple[str, datetime, float]] = []

    fn_start = _parse_filename_start(file_name)
    if fn_start:
        candidates.append(("filename", fn_start, 1000.0))

    if prev_start:
        candidates.append(("database", prev_start, 200.0))

    if prev_start:
        candidates.append(("hkt+8h", prev_start + _HKT_SHIFT, 150.0))
        candidates.append(("hkt-8h", prev_start - _HKT_SHIFT, 150.0))
    if fn_start:
        candidates.append(("fn+hkt+8h", fn_start + _HKT_SHIFT, 180.0))

    scored: list[tuple[str, datetime, float]] = []
    for name, start, base in candidates:
        extra = _score_window(conn, start, duration_sec, annotations)
        scored.append((name, start, base + extra))

    if not scored:
        now = datetime.now(UTC)
        start = now - timedelta(seconds=duration_sec)
        return {
            "ok": True,
            "method": "unchanged",
            "confidence": 0.0,
            "start_time_utc": start.isoformat(),
            "end_time_utc": now.isoformat(),
            "shift_sec": 0.0,
            "annotation_shift_sec": 0.0,
            "sources": [],
            "details": "无可用先验",
        }

    scored.sort(key=lambda x: x[2], reverse=True)
    best_name, best_start, best_score = scored[0]
    second_score = scored[1][2] if len(scored) > 1 else 0.0
    margin = best_score - second_score
    confidence = min(1.0, max(0.15, margin / max(best_score, 1.0)))

    method = "adsb_fusion"
    if best_name == "filename":
        method = "filename"
    shift_sec = 0.0
    if prev_start:
        shift_sec = (best_start - prev_start).total_seconds()
        if abs(shift_sec) < 2:
            method = "unchanged"

    end = best_start + timedelta(seconds=duration_sec)
    sources = [
        {
            "name": n,
            "start_time_utc": s.isoformat(),
            "end_time_utc": (s + timedelta(seconds=duration_sec)).isoformat(),
            "score": round(sc, 1),
        }
        for n, s, sc in scored[:8]
    ]

    return {
        "ok": True,
        "method": method,
        "confidence": round(confidence, 3),
        "start_time_utc": best_start.isoformat(),
        "end_time_utc": end.isoformat(),
        "shift_sec": round(shift_sec, 2),
        "annotation_shift_sec": 0.0,
        "sources": sources,
        "details": f"最优 {best_name} · 分差 {margin:.0f}",
    }


def apply_correction(
    conn: sqlite3.Connection,
    audio_id: int,
    correction: dict[str, Any],
    *,
    shift_annotations: bool = False,
) -> dict[str, Any]:
    from app.tables import lng_annotations

    conn.execute(
        """
        UPDATE LNG_AUDIO_RECORDS
        SET start_time_utc = ?, end_time_utc = ?
        WHERE audio_id = ?
        """,
        (
            correction["start_time_utc"],
            correction["end_time_utc"],
            audio_id,
        ),
    )

    ann_shift = float(correction.get("annotation_shift_sec") or 0)
    updated_ann = 0
    if shift_annotations and abs(ann_shift) >= 0.5:
        rows = conn.execute(
            "SELECT annotation_id, relative_start, relative_end FROM LNG_ANNOTATIONS WHERE audio_id = ?",
            (audio_id,),
        ).fetchall()
        dur_row = conn.execute(
            "SELECT duration_ms FROM LNG_AUDIO_RECORDS WHERE audio_id = ?", (audio_id,)
        ).fetchone()
        dur_sec = max(1.0, int(dur_row["duration_ms"] or 60000) / 1000.0)
        for row in rows:
            rs = max(0.0, float(row["relative_start"] or 0) + ann_shift)
            re = max(rs + 0.2, float(row["relative_end"] or rs) + ann_shift)
            re = min(dur_sec, re)
            conn.execute(
                "UPDATE LNG_ANNOTATIONS SET relative_start = ?, relative_end = ? WHERE annotation_id = ?",
                (rs, re, int(row["annotation_id"])),
            )
            updated_ann += 1

    conn.commit()
    return {"ok": True, "audio_id": audio_id, "annotations_updated": updated_ann}
