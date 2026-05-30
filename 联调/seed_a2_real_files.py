"""
将 A3 test_wavs 中的真实 wav 复制到 A2 data/audio 并登记到 a2_voice.db（联调无 LiveATC Cookie 时的真实文件兜底）。

有 LiveATC Cookie 时仍应优先: POST :8001/.../trigger/historical

用法:
  python 联调/seed_a2_real_files.py
  python 联调/sync_a2_to_a5.py
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_MEDIA_BASE, A2_ROOT, A3_ROOT

A2_BASE = "http://127.0.0.1:8001"
WAV_SOURCES = [
    A3_ROOT / "test_wavs" / "en.wav",
    A3_ROOT / "test_wavs" / "yue.wav",
    A3_ROOT / "test_wavs" / "zh.wav",
]


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    dest_dir = A2_ROOT / "data" / "audio" / "historical" / day
    dest_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    for src in WAV_SOURCES:
        if not src.exists():
            print(f"[跳过] 不存在: {src}")
            continue
        dest = dest_dir / src.name
        if not dest.exists() or dest.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dest)
        rel_path = dest.relative_to(A2_ROOT).as_posix()
        media_url = f"{A2_MEDIA_BASE}/historical/{day}/{src.name}"
        end = datetime.now(timezone.utc)
        start = end - timedelta(seconds=30)
        payload = {
            "file_name": src.name,
            "file_path": rel_path,
            "start_time_utc": start.isoformat(),
            "end_time_utc": end.isoformat(),
            "source_url": media_url,
            "file_size": dest.stat().st_size,
            "duration_ms": 30000,
        }
        try:
            out = _post_json(f"{A2_BASE}/api/v1/ingestion/realtime/register", payload)
            print(f"[OK] {src.name} -> voice_file_id={out.get('voice_file_id')} url={media_url}")
            copied += 1
        except Exception as exc:  # noqa: BLE001
            print(f"[失败] {src.name}: {exc}")

    if not copied:
        print("未登记任何文件。请确认 A2 :8001 已启动。", file=sys.stderr)
        return 1
    print(f"\n已登记 {copied} 条真实 wav。请运行: python 联调/sync_a2_to_a5.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
