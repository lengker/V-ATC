"""删除 A5/A1 中的 VHHH-DEMO 演示航迹，便于只显示 OpenSky 实时。"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A1_DB, A5_DB

DEMO = ("VHHH-DEMO-CPA123", "A1-DEMO-001")


def purge(db: Path) -> int:
    if not db.exists():
        return 0
    conn = sqlite3.connect(db)
    try:
        cur = conn.execute(
            f"DELETE FROM LNG_TRACKS WHERE flight_id IN ({','.join('?' * len(DEMO))})",
            DEMO,
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def main() -> int:
    n5 = purge(A5_DB)
    n1 = purge(A1_DB)
    print(f"A5 删除 {n5} 条，A1 删除 {n1} 条演示航迹")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
