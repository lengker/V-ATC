"""
从 A1 模块库直接导入航迹到 A5 库（LNG_TRACKS）。

数据源: 联调/ATC-ADSB-Receiver/backend/backend/app/data.sqlite3
目标:   backend/data.sqlite3

用法:
  python 联调/sync_a1_db_to_a5.py
  python 联调/sync_a1_db_to_a5.py --keep-existing   # 不清空，仅追加不重复 flight+timestamp
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A1_DB, A5_DB


def _valid_geo_clause() -> str:
    return (
        "tracks_latitude BETWEEN -90 AND 90 "
        "AND tracks_longitude BETWEEN -180 AND 180"
    )


def sync_tracks(*, replace: bool) -> tuple[int, int, int]:
    if not A1_DB.exists():
        raise FileNotFoundError(f"A1 数据库不存在: {A1_DB}")
    if not A5_DB.exists():
        raise FileNotFoundError(f"A5 数据库不存在: {A5_DB}")

    dst = sqlite3.connect(A5_DB)
    try:
        cols = [
            r[1]
            for r in dst.execute("PRAGMA table_info(LNG_TRACKS)").fetchall()
        ]
        col_list = ", ".join(cols)

        if replace:
            dst.execute("DELETE FROM LNG_TRACKS")
            dst.execute("DELETE FROM sqlite_sequence WHERE name='LNG_TRACKS'")

        dst.execute("ATTACH DATABASE ? AS a1db", (str(A1_DB),))
        total_a1 = dst.execute(
            f"SELECT COUNT(*) FROM a1db.LNG_TRACKS WHERE {_valid_geo_clause()}"
        ).fetchone()[0]

        if replace:
            cur = dst.execute(
                f"""
                INSERT INTO LNG_TRACKS ({col_list})
                SELECT {col_list} FROM a1db.LNG_TRACKS
                WHERE {_valid_geo_clause()}
                """
            )
            inserted = cur.rowcount
        else:
            existing = {
                (r[0], r[1])
                for r in dst.execute(
                    "SELECT flight_id, timestamp FROM LNG_TRACKS"
                ).fetchall()
            }
            rows = dst.execute(
                f"""
                SELECT {col_list} FROM a1db.LNG_TRACKS
                WHERE {_valid_geo_clause()}
                """
            ).fetchall()
            inserted = 0
            placeholders = ", ".join("?" for _ in cols)
            fi, ti = cols.index("flight_id"), cols.index("timestamp")
            for row in rows:
                key = (row[fi], row[ti])
                if key in existing:
                    continue
                dst.execute(
                    f"INSERT INTO LNG_TRACKS ({col_list}) VALUES ({placeholders})",
                    row,
                )
                existing.add(key)
                inserted += 1

        dst.commit()
        dst.execute("DETACH DATABASE a1db")
        total_a5 = dst.execute("SELECT COUNT(*) FROM LNG_TRACKS").fetchone()[0]
        return inserted, total_a5, total_a1
    finally:
        dst.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="A1 ADSB 库 → A5 LNG_TRACKS")
    parser.add_argument(
        "--keep-existing",
        action="store_true",
        help="保留 A5 已有航迹，按 flight_id+timestamp 去重追加",
    )
    args = parser.parse_args()

    try:
        inserted, total_a5, total_a1 = sync_tracks(replace=not args.keep_existing)
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        return 1

    mode = "替换导入" if not args.keep_existing else "追加导入"
    print(
        f"[A1→A5] {mode} 完成: 本次写入 {inserted} 条; "
        f"A1 合法航迹 {total_a1} 条; A5 现有 {total_a5} 条。"
    )
    print("请刷新前端地图查看 ADSB 航迹。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
