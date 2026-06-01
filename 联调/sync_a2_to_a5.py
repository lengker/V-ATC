"""
联调脚本：把 A2 库中的 voice_files 写入 A5 的 LNG_AUDIO_RECORDS，供前端 fetchAnnotationBundle 使用。

- 按 file_name 去重；已存在则尝试 ext/update 修正 source_url（真实媒体对齐）
- source_url 指向 A2 :8001/media/...

用法（先启动 A5:8000 与 A2:8001）:
  python 联调/sync_a2_to_a5.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_DB, A2_MEDIA_BASE, A2_ROOT, A5_BASE, LIAN_DIAO
from purge_recordings_without_transcript import load_blocklist, unblock_a2_files_with_local_media

DEFAULT_TRACK_ID = 1


def _iso_utc(d: datetime) -> str:
    return d.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _now_capture_window_ms(duration_ms: int) -> tuple[str, str]:
    """仅当 A2/文件名均无法解析采集时刻时的兜底。"""
    end = datetime.now(timezone.utc)
    dur = max(1000, int(duration_ms or 0) or 60_000)
    start = end - timedelta(milliseconds=dur)
    return _iso_utc(start), _iso_utc(end)


def _utc_from_filename(file_name: str, duration_ms: int) -> tuple[str, str] | None:
    """从 LiveATC 等文件名解析 UTC 起止（与前端 recording-display 规则一致）。"""
    import re

    stem = re.sub(r"\.(mp3|wav|m4a|ogg|aac)$", "", (file_name or "").strip(), flags=re.I)
    if not stem:
        return None
    dur = max(1000, int(duration_ms or 0) or 60_000)

    m = re.match(
        r"^vhhh[_-]?(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})$",
        stem,
        re.I,
    )
    if m:
        y, mo, d, h, mi, s = (int(x) for x in m.groups())
        start = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
        return _iso_utc(start), _iso_utc(start + timedelta(milliseconds=dur))

    m = re.search(r"(\d{4})(\d{2})(\d{2})[tT](\d{2})(\d{2})(\d{2})", stem)
    if m:
        y, mo, d, h, mi, s = (int(x) for x in m.groups())
        start = datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
        return _iso_utc(start), _iso_utc(start + timedelta(milliseconds=dur))

    m = re.search(r"(\d{4})-(\d{2})-(\d{2})-(\d{4})Z", stem, re.I)
    if m:
        y, mo, d, hm = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4)
        h, mi = int(hm[:2]), int(hm[2:])
        start = datetime(y, mo, d, h, mi, 0, tzinfo=timezone.utc)
        return _iso_utc(start), _iso_utc(start + timedelta(milliseconds=dur))
    return None


def _resolve_capture_utc(row: sqlite3.Row, file_name: str, duration_ms: int) -> tuple[str, str]:
    start = row["start_time_utc"]
    end = row["end_time_utc"]
    if start and end:
        return str(start), str(end)
    parsed = _utc_from_filename(file_name, duration_ms)
    if parsed:
        return parsed
    return _now_capture_window_ms(duration_ms)


def _get_json(url: str) -> list:
    with urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data if isinstance(data, list) else []


def _post_json(url: str, payload: dict) -> dict | list:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _a5_audio_by_filename() -> dict[str, dict]:
    rows = _get_json(f"{A5_BASE}/tables/audio_records?limit=1000")
    out: dict[str, dict] = {}
    for r in rows:
        name = str(r.get("file_name") or "")
        if not name:
            continue
        aid = int(r["audio_id"])
        if name not in out or aid > int(out[name].get("audio_id", 0)):
            out[name] = r
    return out


def _media_url(file_path: str) -> str:
    p = Path(file_path.replace("\\", "/"))
    parts = p.parts
    if "audio" in parts:
        idx = parts.index("audio")
        rel = "/".join(parts[idx + 1 :])
    else:
        rel = p.name
    return f"{A2_MEDIA_BASE}/{rel}"


def _resolve_local_path(file_path: str) -> Path | None:
    fp = file_path or ""
    if fp and not Path(fp).is_absolute():
        fp_abs = (A2_ROOT / fp).resolve()
    else:
        fp_abs = Path(fp).resolve() if fp else None
    if fp_abs and fp_abs.exists():
        return fp_abs
    return None


def run_sync(*, ignore_blocklist: bool = False) -> dict[str, int | str]:
    """同步 A2 voice_files → A5 LNG_AUDIO_RECORDS。返回统计 dict。"""
    if ignore_blocklist:
        unblock_a2_files_with_local_media()

    if not A2_DB.exists():
        return {"ok": 0, "error": "a2_db_missing", "synced": 0, "updated": 0, "skipped": 0, "a2_total": 0}

    conn = sqlite3.connect(A2_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, file_name, file_path, source_url, start_time_utc, end_time_utc, "
        "duration_ms, file_size, status, track_id FROM t_a2_voice_files ORDER BY id"
    ).fetchall()
    conn.close()

    if not rows:
        return {"ok": 0, "error": "a2_empty", "synced": 0, "updated": 0, "skipped": 0, "a2_total": 0}

    existing_by_name = _a5_audio_by_filename()
    blocklist = set() if ignore_blocklist else load_blocklist()
    synced = 0
    updated = 0
    skipped = 0
    blocked = 0
    for row in rows:
        fname = str(row["file_name"] or "")
        if fname and fname in blocklist:
            blocked += 1
            continue
        fp_abs = _resolve_local_path(str(row["file_path"] or ""))
        if not fp_abs:
            skipped += 1
            continue

        source_url = _media_url(str(row["file_path"] or row["file_name"]))
        track_id = row["track_id"] if row["track_id"] is not None else DEFAULT_TRACK_ID

        if fname and fname in existing_by_name:
            a5_row = existing_by_name[fname]
            audio_id = int(a5_row["audio_id"])
            old_url = str(a5_row.get("source_url") or "")
            dur_ms = int(row["duration_ms"] or 0) or 60_000
            should_touch = ignore_blocklist or old_url != source_url
            if should_touch:
                values: dict[str, object] = {
                    "source_url": source_url,
                    "file_path": str(fp_abs),
                    "file_size": int(row["file_size"] or 0) or fp_abs.stat().st_size,
                    "duration_ms": dur_ms,
                }
                try:
                    _post_json(
                        f"{A5_BASE}/tables/audio_records/ext/update/{audio_id}",
                        {"values": values},
                    )
                    updated += 1
                except Exception:  # noqa: BLE001
                    skipped += 1
            else:
                skipped += 1
            continue

        dur_ms = int(row["duration_ms"] or 0) or 60_000
        start_iso, end_iso = _resolve_capture_utc(row, fname, dur_ms)
        payload = {
            "source_url": source_url,
            "start_time_utc": start_iso,
            "end_time_utc": end_iso,
            "duration_ms": dur_ms,
            "file_name": row["file_name"],
            "file_path": str(fp_abs),
            "file_size": int(row["file_size"] or 0) or fp_abs.stat().st_size,
            "status": int(row["status"] or 1),
            "track_id": int(track_id),
        }
        try:
            created = _post_json(f"{A5_BASE}/tables/audio_records/ext/create", payload)
            audio_id = created.get("audio_id") if isinstance(created, dict) else created
            synced += 1
            if fname:
                existing_by_name[fname] = {"audio_id": audio_id, "file_name": fname, "source_url": source_url}
        except Exception:  # noqa: BLE001
            skipped += 1

    a5_count = len(_get_json(f"{A5_BASE}/tables/audio_records?limit=1000"))
    return {
        "ok": 1,
        "synced": synced,
        "updated": updated,
        "skipped": skipped,
        "blocked": blocked,
        "a2_total": len(rows),
        "a5_total": a5_count,
    }


def main() -> int:
    stats = run_sync()
    if stats.get("error") == "a2_db_missing":
        print(f"A2 数据库不存在: {A2_DB}", file=sys.stderr)
        return 1
    if stats.get("error") == "a2_empty":
        print("A2 库中没有任何 voice_files", file=sys.stderr)
        return 1

    print(
        f"A2 {stats['a2_total']} 条 → A5 新建 {stats['synced']}、更新 {stats['updated']}、"
        f"跳过 {stats['skipped']}、阻止再同步 {stats.get('blocked', 0)}；A5 现共 {stats['a5_total']} 条"
    )
    return 0 if (int(stats["synced"]) + int(stats["updated"])) else 2


if __name__ == "__main__":
    raise SystemExit(main())
