# -*- coding: utf-8 -*-
"""Pack Week 4 deliverables into 第四周成果物.zip."""
from __future__ import annotations

import os
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEEK4 = ROOT / "第四周"
CODE = WEEK4 / "code"
ZIP_PATH = ROOT / "第四周成果物.zip"

# Source files to snapshot into 第四周/code/
FRONT_FILES = [
    ("front/src/context/PlaybackContext.tsx", "front/PlaybackContext.tsx"),
    ("front/src/components/audio-waveform.tsx", "front/audio-waveform.tsx"),
    ("front/src/components/adsb-map-leaflet.tsx", "front/adsb-map-leaflet.tsx"),
    ("front/src/components/time-rover.tsx", "front/time-rover.tsx"),
    ("front/src/lib/adsb-playback.ts", "front/adsb-playback.ts"),
    ("front/src/lib/adsb-interpolation.ts", "front/adsb-interpolation.ts"),
    ("front/src/components/annotation-page.tsx", "front/annotation-page.tsx"),
    ("front/src/components/text-editor.tsx", "front/text-editor.tsx"),
    ("front/src/lib/api.ts", "front/api.ts"),
    ("front/src/lib/backend-api.ts", "front/backend-api.ts"),
    ("front/src/lib/local-annotation-store.ts", "front/local-annotation-store.ts"),
    ("front/src/components/transcript-timeline-editor.tsx", "front/transcript-timeline-editor.tsx"),
]

INTEGRATION_FILES = [
    ("联调/health-check.ps1", "integration/health-check.ps1"),
    ("联调/start-all.ps1", "integration/start-all.ps1"),
    ("联调/sync_all_to_a5.py", "integration/sync_all_to_a5.py"),
]


def copy_sources() -> None:
    log_backup: bytes | None = None
    log_path = WEEK4 / "code" / "logs" / "week4-integration-test.log"
    if log_path.exists():
        log_backup = log_path.read_bytes()

    if CODE.exists():
        shutil.rmtree(CODE)
    CODE.mkdir(parents=True)

    for src_rel, dst_rel in FRONT_FILES + INTEGRATION_FILES:
        src = ROOT / src_rel
        dst = CODE / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.exists():
            shutil.copy2(src, dst)
        else:
            dst.write_text(f"# Source not found: {src_rel}\n", encoding="utf-8")

    logs_dir = CODE / "logs"
    logs_dir.mkdir(exist_ok=True)
    if log_backup is not None:
        (logs_dir / "week4-integration-test.log").write_bytes(log_backup)


def make_zip() -> None:
    if ZIP_PATH.exists():
        ZIP_PATH.unlink()
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(WEEK4):
            dirs.sort()
            for fname in sorted(files):
                full = Path(root) / fname
                rel = full.relative_to(ROOT)
                zf.write(full, rel.as_posix())


def main() -> None:
    copy_sources()
    make_zip()
    size_mb = ZIP_PATH.stat().st_size / (1024 * 1024)
    with zipfile.ZipFile(ZIP_PATH) as zf:
        n = len(zf.namelist())
    print(f"Created {ZIP_PATH} ({size_mb:.2f} MB, {n} entries)")


if __name__ == "__main__":
    main()
