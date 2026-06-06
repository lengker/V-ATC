"""按 UTC 时刻用 SeleniumBase 下载 LiveATC 历史档（与 liveatc_downloader ArchiveDownloader 同源逻辑）。"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "ATC-VA-A2"))

from refresh_recordings_pipeline import download_historical_at  # noqa: E402


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": 0, "error": "usage: download_historical_selenium.py <utc_iso> [a3_asr=0|1]"}))
        return 1
    utc = sys.argv[1]
    a3 = len(sys.argv) > 2 and sys.argv[2] in ("1", "true", "True")
    print(json.dumps(download_historical_at(utc, sync_a5=True, a3_asr=a3), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
