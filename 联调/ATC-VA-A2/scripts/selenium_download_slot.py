#!/usr/bin/env python3
"""在 A2 目录内下载单个历史档（供联调 pipeline 子进程调用，避免 app 包名冲突）。"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.liveatc_selenium_archive import (  # noqa: E402
    LiveATCSeleniumDownloadError,
    download_archive_slot,
)


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: selenium_download_slot.py <utc_iso>"}))
        return 1
    raw = sys.argv[1].strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(raw)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    out_dir = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "liveatc-downloader" / "downloads")
    try:
        path = download_archive_slot(dt, output_dir=Path(out_dir))
        print(
            json.dumps(
                {
                    "ok": True,
                    "file_name": path.name,
                    "path": str(path.resolve()),
                    "slot_utc": dt.isoformat(),
                },
                ensure_ascii=False,
            )
        )
        return 0
    except LiveATCSeleniumDownloadError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
