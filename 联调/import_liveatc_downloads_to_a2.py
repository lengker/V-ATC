"""
将 liveatc-downloader/downloads 下已下载的 mp3 登记到 A2（需 A2 :8001 运行）。

用法:
  cd 联调/ATC-VA-A2/liveatc-downloader
  python vhhh_multimethod_download.py --cookie-file .local/liveatc_cookie.txt --count 2
  cd ../..
  python 联调/import_liveatc_downloads_to_a2.py
  python 联调/sync_a2_to_a5.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A2_MEDIA_BASE, A2_ROOT

A2_BASE = "http://127.0.0.1:8001"
DOWNLOADS = A2_ROOT / "liveatc-downloader" / "downloads"


def _post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _parse_times(name: str) -> tuple[datetime, datetime]:
    m = re.search(r"(\d{4})Z", name, re.I)
    if m:
        try:
            end = datetime.strptime(m.group(1), "%H%MZ").replace(
                year=datetime.now(timezone.utc).year,
                month=datetime.now(timezone.utc).month,
                day=datetime.now(timezone.utc).day,
                tzinfo=timezone.utc,
            )
            start = end - timedelta(minutes=30)
            return start, end
        except ValueError:
            pass
    end = datetime.now(timezone.utc)
    return end - timedelta(minutes=30), end


def main() -> int:
    if not DOWNLOADS.is_dir():
        print(f"目录不存在: {DOWNLOADS}", file=sys.stderr)
        return 1
    mp3s = sorted(DOWNLOADS.glob("*.mp3"))
    if not mp3s:
        print("downloads 下无 mp3，请先运行 vhhh_multimethod_download.py", file=sys.stderr)
        return 1

    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    dest_dir = A2_ROOT / "data" / "audio" / "historical" / day
    dest_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for src in mp3s:
        dest = dest_dir / src.name
        if not dest.exists():
            dest.write_bytes(src.read_bytes())
        rel = dest.relative_to(A2_ROOT).as_posix()
        media = f"{A2_MEDIA_BASE}/historical/{day}/{src.name}"
        start, end = _parse_times(src.name)
        payload = {
            "file_name": src.name,
            "file_path": rel,
            "start_time_utc": start.isoformat(),
            "end_time_utc": end.isoformat(),
            "source_url": media,
            "file_size": dest.stat().st_size,
            "duration_ms": 30 * 60 * 1000,
        }
        try:
            out = _post_json(f"{A2_BASE}/api/v1/ingestion/realtime/register", payload)
            print(f"[OK] {src.name} voice_file_id={out.get('voice_file_id')}")
            n += 1
        except Exception as exc:  # noqa: BLE001
            print(f"[失败] {src.name}: {exc}")
    print(f"登记 {n}/{len(mp3s)} 条。运行 sync_a2_to_a5.py")
    return 0 if n else 2


if __name__ == "__main__":
    raise SystemExit(main())
