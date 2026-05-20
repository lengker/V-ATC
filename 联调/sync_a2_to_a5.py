"""
联调脚本：把 A2 库中的 voice_files 写入 A5 的 LNG_AUDIO_RECORDS，供前端 fetchAnnotationBundle 使用。

用法（先启动 A5:8000，可选 A2:8001 用于 /media 播放）:
  python 联调/sync_a2_to_a5.py
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
A2_DB = ROOT / "ATC-VA-A2" / "a2_voice.db"
A5_BASE = "http://127.0.0.1:8000"
A2_MEDIA_BASE = "http://127.0.0.1:8001/media"
DEFAULT_TRACK_ID = 1


def _post_json(url: str, payload: dict) -> dict | list:
    body = json.dumps(payload).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _media_url(file_path: str) -> str:
    p = Path(file_path.replace("\\", "/"))
    # 库中多为 data/audio/realtime/... 相对路径
    parts = p.parts
    if "audio" in parts:
        idx = parts.index("audio")
        rel = "/".join(parts[idx + 1 :])
    else:
        rel = p.name
    return f"{A2_MEDIA_BASE}/{rel}"


def main() -> int:
    if not A2_DB.exists():
        print(f"A2 数据库不存在: {A2_DB}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(A2_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, file_name, file_path, source_url, start_time_utc, end_time_utc, "
        "duration_ms, file_size, status, track_id FROM t_a2_voice_files ORDER BY id"
    ).fetchall()
    conn.close()

    if not rows:
        print("A2 库中没有任何 voice_files，请先运行采集或 POST /api/v1/ingestion/.../register")
        return 1

    print(f"发现 {len(rows)} 条 A2 录音，开始同步到 A5 ({A5_BASE})…")

    synced = 0
    for row in rows:
        track_id = row["track_id"] if row["track_id"] is not None else DEFAULT_TRACK_ID
        fp = row["file_path"] or ""
        if fp and not Path(fp).is_absolute():
            fp_abs = (ROOT / "ATC-VA-A2" / fp).resolve()
        else:
            fp_abs = Path(fp) if fp else None

        if fp_abs and not fp_abs.exists():
            print(f"  [跳过] id={row['id']} 文件不存在: {fp_abs}")
            continue

        source_url = _media_url(str(row["file_path"] or row["file_name"]))
        payload = {
            "source_url": source_url,
            "start_time_utc": row["start_time_utc"],
            "end_time_utc": row["end_time_utc"],
            "duration_ms": int(row["duration_ms"] or 0) or 60000,
            "file_name": row["file_name"],
            "file_path": str(fp_abs) if fp_abs else source_url,
            "file_size": int(row["file_size"] or 0) or (fp_abs.stat().st_size if fp_abs else 0),
            "status": int(row["status"] or 1),
            "track_id": int(track_id),
        }
        try:
            created = _post_json(f"{A5_BASE}/tables/audio_records/ext/create", payload)
            audio_id = created.get("audio_id") if isinstance(created, dict) else created
            print(f"  [OK] A2 voice_file_id={row['id']} -> A5 audio_id={audio_id} url={source_url}")
            synced += 1
        except Exception as exc:  # noqa: BLE001
            print(f"  [失败] id={row['id']}: {exc}")

    print(f"\n完成：成功写入 A5 {synced}/{len(rows)} 条。请刷新前端 http://localhost:3000")
    return 0 if synced else 2


if __name__ == "__main__":
    raise SystemExit(main())
