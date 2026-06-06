"""按 UTC 时间段查询录音、合并导出音频与可视化转写文本。"""
from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

UTC = timezone.utc

from app.tables import lng_audio_records

Strategy = Literal["concat", "single_longest"]

_LIVEATC_SLOT = re.compile(
    r"([A-Za-z]{3})-(\d{1,2})-(\d{4})-(\d{4})Z", re.IGNORECASE
)

EXPORT_CACHE_DIR = Path(__file__).resolve().parents[1] / "static" / "export-cache"


def _format_utc_chinese(dt: datetime) -> str:
    dt = dt.astimezone(UTC)
    pad = lambda n: str(n).zfill(2)
    return (
        f"{dt.year}年{pad(dt.month)}月{pad(dt.day)}日"
        f"{pad(dt.hour)}时{pad(dt.minute)}分{pad(dt.second)}秒"
    )


def _effective_recording_start(rec: dict[str, Any]) -> datetime | None:
    fname = str(rec.get("file_name") or "")
    matched = _LIVEATC_SLOT.search(fname)
    if matched:
        month_text, day_text, year_text, hhmm_text = matched.groups()
        try:
            month = datetime.strptime(month_text[:3], "%b").month
            day = int(day_text)
            year = int(year_text)
            hour = int(hhmm_text[:2])
            minute = int(hhmm_text[2:])
            return datetime(year, month, day, hour, minute, tzinfo=UTC)
        except ValueError:
            pass
    return lng_audio_records._parse_utc_text(str(rec.get("start_time_utc") or ""))


def _sort_recordings_for_merge(recordings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    def key_fn(rec: dict[str, Any]) -> tuple[float, int]:
        start = _effective_recording_start(rec)
        ts = start.timestamp() if start else 0.0
        return (ts, int(rec.get("audio_id") or 0))

    return sorted(recordings, key=key_fn)


def _recording_duration_sec(rec: dict[str, Any]) -> float:
    dur_ms = int(rec.get("duration_ms") or 0)
    if dur_ms > 0:
        return max(1.0, dur_ms / 1000.0)
    start = lng_audio_records._parse_utc_text(str(rec.get("start_time_utc") or ""))
    end = lng_audio_records._parse_utc_text(str(rec.get("end_time_utc") or ""))
    if start and end and end > start:
        return max(1.0, (end - start).total_seconds())
    return 60.0


def build_merged_timestamps(
    conn: sqlite3.Connection, ordered: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    audio_ids = [int(r["audio_id"]) for r in ordered]
    ann_map = _annotations_by_audio(conn, audio_ids)
    offset = 0.0
    out: list[dict[str, Any]] = []
    for rec in ordered:
        aid = int(rec["audio_id"])
        dur = _recording_duration_sec(rec)
        for seg in ann_map.get(aid) or []:
            rel_start = float(seg.get("relative_start") or 0)
            rel_end = float(seg.get("relative_end") or rel_start)
            if rel_end <= rel_start:
                rel_end = rel_start + 0.5
            text = str(seg.get("annotation_text") or seg.get("asr_content") or "").strip()
            out.append(
                {
                    "id": f"{aid}-{seg.get('annotation_id')}",
                    "startTime": round(offset + rel_start, 3),
                    "endTime": round(offset + min(rel_end, dur), 3),
                    "text": text,
                    "speaker": str(seg.get("label_type") or "").strip() or None,
                    "confidence": float(seg["vad_confidence"])
                    if seg.get("vad_confidence") is not None
                    else None,
                }
            )
        offset += dur
    return out


def build_merge_for_player(
    conn: sqlite3.Connection,
    *,
    start_utc: str,
    end_utc: str,
    strategy: Strategy = "concat",
) -> dict[str, Any]:
    """合并时段内录音，写入 static/export-cache，返回前端加载所需 JSON。"""
    range_start = lng_audio_records._parse_utc_text(start_utc)
    range_end = lng_audio_records._parse_utc_text(end_utc)
    if range_start is None or range_end is None:
        raise ValueError("start_utc / end_utc 格式无效")
    if range_end <= range_start:
        raise ValueError("end_utc 必须晚于 start_utc")

    recordings = _sort_recordings_for_merge(
        lng_audio_records.list_by_utc_range(conn, start_utc, end_utc)
    )
    transcript = build_visual_transcript(
        conn, recordings, range_start=range_start, range_end=range_end
    )
    source_ids = [int(r["audio_id"]) for r in recordings]
    timestamps = build_merged_timestamps(conn, recordings)

    result: dict[str, Any] = {
        "ok": True,
        "count": len(recordings),
        "start_utc": start_utc,
        "end_utc": end_utc,
        "strategy": strategy,
        "source_audio_ids": source_ids,
        "timestamps": timestamps,
        "transcript": transcript,
        "has_audio": False,
        "audio_url": None,
        "duration_sec": 0,
        "merge_id": None,
    }

    if not recordings:
        result["merge_id"] = f"utc-merge-empty-{int(range_start.timestamp())}"
        return result

    local_paths: list[Path] = []
    for rec in recordings:
        fp = _resolve_local_audio(str(rec.get("file_path") or ""))
        if fp:
            local_paths.append(fp)

    EXPORT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    sig = hashlib.sha256(
        (f"{start_utc}|{end_utc}|{strategy}|" + ",".join(str(i) for i in source_ids)).encode(
            "utf-8"
        )
    ).hexdigest()[:16]
    merge_id = f"utc-merge-{sig}"
    out_name = f"{merge_id}.mp3"
    out_path = EXPORT_CACHE_DIR / out_name

    merged_path: Path | None = None
    pick: dict[str, Any] | None = None
    if strategy == "single_longest":
        pick = _pick_single_longest(recordings, range_start, range_end)
        merged_path = _resolve_local_audio(str(pick.get("file_path") or "")) if pick else None
    elif local_paths:
        if len(local_paths) == 1:
            merged_path = local_paths[0]
        elif _ffmpeg_concat(local_paths, out_path):
            merged_path = out_path
        else:
            merged_path = local_paths[0]

    total_dur = sum(_recording_duration_sec(r) for r in recordings)
    if merged_path and merged_path.is_file():
        if merged_path.resolve() != out_path.resolve():
            shutil.copy2(merged_path, out_path)
        result["has_audio"] = True
        result["audio_url"] = f"/static/export-cache/{out_name}"
        if strategy == "single_longest" and pick:
            result["duration_sec"] = int(_recording_duration_sec(pick))
        elif strategy == "concat" and len(local_paths) > 1:
            result["duration_sec"] = int(total_dur)
        else:
            result["duration_sec"] = int(_recording_duration_sec(recordings[0]))
    else:
        result["duration_sec"] = int(total_dur)

    result["merge_id"] = merge_id
    result["title"] = (
        f"UTC合并 {range_start.strftime('%Y-%m-%d %H:%M')}—{range_end.strftime('%H:%M')}Z "
        f"({len(recordings)}段)"
    )
    return result


def _resolve_local_audio(path_str: str) -> Path | None:
    if not path_str or not str(path_str).strip():
        return None
    p = Path(str(path_str).replace("\\", "/"))
    if p.is_file():
        return p.resolve()
    qt_root = Path(__file__).resolve().parents[3]
    for base in (qt_root, qt_root / "联调" / "ATC-VA-A2"):
        cand = (base / p).resolve() if not p.is_absolute() else p
        if cand.is_file():
            return cand
    return None


def _annotations_by_audio(
    conn: sqlite3.Connection, audio_ids: list[int]
) -> dict[int, list[dict[str, Any]]]:
    if not audio_ids:
        return {}
    placeholders = ",".join("?" * len(audio_ids))
    rows = conn.execute(
        f"""
        SELECT annotation_id, audio_id, relative_start, relative_end,
               annotation_text, asr_content, label_type, vad_confidence
        FROM LNG_ANNOTATIONS
        WHERE audio_id IN ({placeholders})
        ORDER BY audio_id, relative_start
        """,
        tuple(audio_ids),
    ).fetchall()
    out: dict[int, list[dict[str, Any]]] = {}
    for row in rows:
        aid = int(row["audio_id"])
        out.setdefault(aid, []).append(dict(row))
    return out


def build_visual_transcript(
    conn: sqlite3.Connection,
    recordings: list[dict[str, Any]],
    *,
    range_start: datetime,
    range_end: datetime,
) -> str:
    lines: list[str] = [
        f"# UTC 时段 {_format_utc_chinese(range_start)} — {_format_utc_chinese(range_end)}",
        f"# 命中录音 {len(recordings)} 条",
        "",
    ]
    if not recordings:
        lines.append("（本时段无录音）")
        return "\n".join(lines)

    audio_ids = [int(r["audio_id"]) for r in recordings]
    ann_map = _annotations_by_audio(conn, audio_ids)

    for rec in recordings:
        aid = int(rec["audio_id"])
        fname = str(rec.get("file_name") or "")
        start = lng_audio_records._parse_utc_text(str(rec.get("start_time_utc") or ""))
        end = lng_audio_records._parse_utc_text(str(rec.get("end_time_utc") or ""))
        if start is None:
            lines.append(f"## 录音 #{aid} {fname}")
            lines.append("（无法解析 start_time_utc）\n")
            continue
        if end is None:
            dur_ms = int(rec.get("duration_ms") or 0) or 60_000
            end = start + timedelta(milliseconds=dur_ms)

        lines.append(f"## 录音 #{aid} {fname}")
        lines.append(
            f"窗口 {_format_utc_chinese(start)} — {_format_utc_chinese(end)}"
        )
        segments = ann_map.get(aid) or []
        if not segments:
            lines.append("（无转写标注）\n")
            continue
        for seg in segments:
            rel_start = float(seg.get("relative_start") or 0)
            rel_end = float(seg.get("relative_end") or rel_start)
            abs_start = start + timedelta(seconds=rel_start)
            abs_end = start + timedelta(seconds=rel_end)
            text = str(seg.get("annotation_text") or seg.get("asr_content") or "").strip()
            speaker = str(seg.get("label_type") or "").strip()
            sp = f"[{speaker}] " if speaker else ""
            lines.append(
                f"[{_format_utc_chinese(abs_start)} – {_format_utc_chinese(abs_end)}] "
                f"{sp}{text or '（空）'}"
            )
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def _ffmpeg_concat(paths: list[Path], out_path: Path) -> bool:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg or len(paths) == 0:
        return False
    if len(paths) == 1:
        shutil.copy2(paths[0], out_path)
        return True
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as lst:
        for p in paths:
            safe = str(p.resolve()).replace("'", "'\\''")
            lst.write(f"file '{safe}'\n")
        list_path = lst.name
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-c", "copy", str(out_path)],
            capture_output=True,
            text=True,
            timeout=600,
        )
        return proc.returncode == 0 and out_path.is_file() and out_path.stat().st_size > 0
    except (OSError, subprocess.TimeoutExpired):
        return False
    finally:
        Path(list_path).unlink(missing_ok=True)


def _pick_single_longest(
    recordings: list[dict[str, Any]], range_start: datetime, range_end: datetime
) -> dict[str, Any] | None:
    best: dict[str, Any] | None = None
    best_overlap = timedelta(0)
    for rec in recordings:
        rs = lng_audio_records._parse_utc_text(str(rec.get("start_time_utc") or ""))
        re_ = lng_audio_records._parse_utc_text(str(rec.get("end_time_utc") or ""))
        if rs is None:
            continue
        if re_ is None:
            dur_ms = int(rec.get("duration_ms") or 0) or 60_000
            re_ = rs + timedelta(milliseconds=dur_ms)
        overlap_start = max(rs, range_start)
        overlap_end = min(re_, range_end)
        if overlap_end > overlap_start:
            ov = overlap_end - overlap_start
            if ov > best_overlap:
                best_overlap = ov
                best = rec
    return best


def build_export_zip(
    conn: sqlite3.Connection,
    *,
    start_utc: str,
    end_utc: str,
    strategy: Strategy = "concat",
) -> tuple[bytes, dict[str, Any]]:
    range_start = lng_audio_records._parse_utc_text(start_utc)
    range_end = lng_audio_records._parse_utc_text(end_utc)
    if range_start is None or range_end is None:
        raise ValueError("start_utc / end_utc 格式无效")
    if range_end <= range_start:
        raise ValueError("end_utc 必须晚于 start_utc")

    recordings = _sort_recordings_for_merge(
        lng_audio_records.list_by_utc_range(conn, start_utc, end_utc)
    )
    transcript = build_visual_transcript(
        conn, recordings, range_start=range_start, range_end=range_end
    )

    meta: dict[str, Any] = {
        "ok": True,
        "count": len(recordings),
        "start_utc": start_utc,
        "end_utc": end_utc,
        "strategy": strategy,
        "has_audio": False,
        "audio_file": None,
        "recordings": [
            {
                "audio_id": int(r["audio_id"]),
                "file_name": r.get("file_name"),
                "start_time_utc": r.get("start_time_utc"),
                "end_time_utc": r.get("end_time_utc"),
            }
            for r in recordings
        ],
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("transcript-visual.txt", transcript.encode("utf-8"))
        zf.writestr(
            "manifest.json",
            __import__("json").dumps(meta, ensure_ascii=False, indent=2).encode("utf-8"),
        )

        local_paths: list[Path] = []
        for rec in recordings:
            fp = _resolve_local_audio(str(rec.get("file_path") or ""))
            if fp:
                local_paths.append(fp)
                zf.write(fp, arcname=f"segments/{fp.name}")

        merged_name = "merged.mp3"
        if not local_paths:
            zf.writestr(merged_name, b"")
            zf.writestr("README.txt", "本时段无可用本地音频文件；仅提供 transcript-visual.txt\n".encode("utf-8"))
        elif strategy == "single_longest":
            pick = _pick_single_longest(recordings, range_start, range_end)
            pick_path = _resolve_local_audio(str(pick.get("file_path") or "")) if pick else None
            if pick_path:
                zf.write(pick_path, arcname=merged_name)
                meta["has_audio"] = True
                meta["audio_file"] = merged_name
            else:
                zf.writestr(merged_name, b"")
        else:
            with tempfile.TemporaryDirectory() as td:
                out = Path(td) / "merged.mp3"
                if _ffmpeg_concat(local_paths, out):
                    zf.write(out, arcname=merged_name)
                    meta["has_audio"] = True
                    meta["audio_file"] = merged_name
                elif len(local_paths) == 1:
                    zf.write(local_paths[0], arcname=merged_name)
                    meta["has_audio"] = True
                    meta["audio_file"] = merged_name
                else:
                    zf.writestr(
                        "README.txt",
                        (
                            "未能合并音频（请安装 ffmpeg 并加入 PATH）。"
                            "segments/ 下为分段原文件。\n"
                        ).encode("utf-8"),
                    )
                    zf.writestr(merged_name, b"")

    buf.seek(0)
    return buf.getvalue(), meta
