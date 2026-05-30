"""
一键从 A1 / A2 / A3 三个模块 SQLite 导入数据到 A5（前端唯一数据源）。

前置: A5 :8000 已启动；A2 :8001、A3 :9002 建议启动（用于音频播放 URL）。

用法:
  python 联调/sync_all_to_a5.py
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable


def _run(script: str) -> int:
    print(f"\n{'=' * 60}\n>>> {script}\n{'=' * 60}")
    r = subprocess.run([PY, str(ROOT / script)], cwd=str(ROOT))
    return int(r.returncode)


def main() -> int:
    steps = [
        "sync_a1_db_to_a5.py",
        "sync_a2_to_a5.py",
        "sync_a3_db_to_a5.py",
    ]
    failed = []
    for s in steps:
        code = _run(s)
        if code != 0:
            failed.append((s, code))
    print("\n" + "=" * 60)
    if failed:
        print("部分步骤失败:", failed)
        return 1
    print("全部完成。请刷新 http://localhost:3000")
    print("  - 地图: A1 航迹 (LNG_TRACKS)")
    print("  - 录音: A2 + A3 音频")
    print("  - 文本: A3 ASR 标注（及此前 demo 标注）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
