"""
写入 VHHH 附近演示进近航迹链（带 next_id/prev_id），并关联 vhhh 录音。

用法（A5 :8000 可不开，直接写 SQLite）:
  python 联调/seed_vhhh_tracks_to_a5.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A5_DB

FLIGHT_ID = "VHHH-DEMO-CPA123"

# 进近示意：约 8s 一点，与 60s 录音时间轴对齐
ROUTE = [
    {"t": 0, "lat": 22.25, "lon": 113.82, "alt": 8000, "spd": 220, "hdg": 70},
    {"t": 8, "lat": 22.265, "lon": 113.855, "alt": 6500, "spd": 210, "hdg": 75},
    {"t": 16, "lat": 22.282, "lon": 113.885, "alt": 5200, "spd": 195, "hdg": 80},
    {"t": 24, "lat": 22.295, "lon": 113.905, "alt": 4000, "spd": 180, "hdg": 85},
    {"t": 32, "lat": 22.305, "lon": 113.918, "alt": 2800, "spd": 165, "hdg": 88},
    {"t": 40, "lat": 22.312, "lon": 113.928, "alt": 1800, "spd": 150, "hdg": 90},
    {"t": 48, "lat": 22.318, "lon": 113.935, "alt": 900, "spd": 135, "hdg": 92},
    {"t": 56, "lat": 22.322, "lon": 113.942, "alt": 300, "spd": 120, "hdg": 95},
]


def main() -> int:
    if not A5_DB.exists():
        print(f"A5 库不存在: {A5_DB}")
        return 1

    conn = sqlite3.connect(A5_DB)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("DELETE FROM LNG_TRACKS WHERE flight_id = ?", (FLIGHT_ID,))

        prev_id: int | None = None
        head_id: int | None = None
        for pt in ROUTE:
            cur = conn.execute(
                """
                INSERT INTO LNG_TRACKS (
                    timestamp, flight_id, tracks_latitude, tracks_longitude,
                    altitude, speed, heading,
                    departure_airport_code, arrival_airport_code,
                    prev_id, next_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'VHHH', 'VHHH', ?, NULL)
                """,
                (
                    str(pt["t"]),
                    FLIGHT_ID,
                    pt["lat"],
                    pt["lon"],
                    pt["alt"],
                    pt["spd"],
                    pt["hdg"],
                    prev_id,
                ),
            )
            track_id = int(cur.lastrowid)
            if prev_id is not None:
                conn.execute(
                    "UPDATE LNG_TRACKS SET next_id = ? WHERE track_id = ?",
                    (track_id, prev_id),
                )
            else:
                head_id = track_id
            prev_id = track_id

        assert head_id is not None
        updated = conn.execute(
            """
            UPDATE LNG_AUDIO_RECORDS
            SET track_id = ?
            WHERE lower(file_name) LIKE '%vhhh%' OR lower(source_url) LIKE '%vhhh%'
            """,
            (head_id,),
        ).rowcount

        conn.commit()
        print(f"已写入 {len(ROUTE)} 个 VHHH 航迹点 flight_id={FLIGHT_ID} head_track_id={head_id}")
        print(f"已关联 {updated} 条 vhhh 录音 → track_id={head_id}")
        print("请刷新前端，地图应显示进近航线与飞机移动。")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
