"""
A1 实时 ADS-B：OpenSky（香港附近 bbox）→ A1/A5 LNG_TRACKS。

用法:
  python 联调/a1_live_collector.py
  python 联调/a1_live_collector.py --once

成功写入实时点后，会从 A5 删除 VHHH-DEMO 演示航迹，避免地图仍显示预置进近。
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from module_paths import A1_DB, A5_DB
from sync_a1_db_to_a5 import sync_tracks

VHHH_BBOX = {
    "lamin": 21.5,
    "lomin": 113.0,
    "lamax": 23.5,
    "lomax": 115.5,
}
LIVE_MARKER = "LIVE"
DEMO_FLIGHT_IDS = ("VHHH-DEMO-CPA123", "A1-DEMO-001")
# OpenSky 匿名 IP 约 10s/次；建议 ≥60s，且全局只跑一个本脚本
POLL_SECONDS = 60
RATE_LIMIT_BACKOFF_START = 90
RATE_LIMIT_BACKOFF_MAX = 300
PRUNE_MINUTES = 240  # 保留约 4 小时轨迹，与前端 /tracks/live?hours=4 一致
MAX_AIRCRAFT_PER_TICK = 250


def _opensky_url() -> str:
    q = "&".join(f"{k}={v}" for k, v in VHHH_BBOX.items())
    return f"https://opensky-network.org/api/states/all?{q}"


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:  # noqa: BLE001
        ctx = ssl.create_default_context()
        if ctx.cert_store_stats().get("x509_ca", 0) == 0:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        return ctx


def _fetch_states_curl() -> list[list]:
    import subprocess

    url = _opensky_url()
    for cmd in (
        ["curl.exe", "-sS", "--max-time", "30", url],
        ["curl", "-sS", "--max-time", "30", url],
    ):
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=35,
                check=False,
            )
        except FileNotFoundError:
            continue
        if proc.returncode != 0:
            raise RuntimeError((proc.stderr or proc.stdout or f"curl exit {proc.returncode}")[:200])
        raw = (proc.stdout or "").strip()
        if raw.lower().startswith("too many"):
            raise RuntimeError("OpenSky: Too many requests（请降低轮询频率，仅保留一个采集进程）")
        data = json.loads(raw)
        return list(data.get("states") or [])
    raise RuntimeError("未找到 curl.exe，无法拉取 OpenSky")


def fetch_states() -> list[list]:
    errors: list[str] = []
    try:
        req = urllib.request.Request(
            _opensky_url(),
            headers={"User-Agent": "qt-a1-live-collector/1.0"},
        )
        with urllib.request.urlopen(req, timeout=30, context=_ssl_context()) as resp:
            raw = resp.read().decode("utf-8", errors="replace").strip()
        if raw.lower().startswith("too many"):
            raise RuntimeError("OpenSky: Too many requests（请降低轮询频率）")
        data = json.loads(raw)
        return list(data.get("states") or [])
    except Exception as exc:  # noqa: BLE001
        errors.append(f"urllib: {exc}")
    try:
        return _fetch_states_curl()
    except Exception as exc:  # noqa: BLE001
        errors.append(f"curl: {exc}")
    raise RuntimeError("; ".join(errors))


def _ensure_tracks_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS LNG_TRACKS (
            track_id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            flight_id TEXT NOT NULL,
            tracks_latitude REAL NOT NULL,
            tracks_longitude REAL NOT NULL,
            altitude REAL,
            speed REAL,
            heading REAL,
            departure_airport_code TEXT,
            arrival_airport_code TEXT,
            next_id INTEGER,
            prev_id INTEGER
        )
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(LNG_TRACKS)").fetchall()}
    if "vertical_rate" not in cols:
        conn.execute("ALTER TABLE LNG_TRACKS ADD COLUMN vertical_rate REAL")


def _utc_now_iso() -> str:
    """毫秒精度，避免同一秒内多架飞机/多次轮询被去重后位置不更新。"""
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _vertical_rate_ft_min(state: list) -> float | None:
    """OpenSky state[11] 为 m/s，界面使用 ft/min。"""
    if len(state) < 12 or state[11] is None:
        return None
    try:
        mps = float(state[11])
    except (TypeError, ValueError):
        return None
    return round(mps * 196.8503937, 1)


def _parse_state(state: list) -> dict | None:
    if len(state) < 11:
        return None
    icao = str(state[0] or "").strip()
    callsign = str(state[1] or "").strip()
    lon = state[5]
    lat = state[6]
    if lat is None or lon is None:
        return None
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
        return None
    flight_id = (callsign or icao or "UNKNOWN").strip()
    return {
        "timestamp": _utc_now_iso(),
        "flight_id": flight_id,
        "tracks_latitude": lat_f,
        "tracks_longitude": lon_f,
        "altitude": float(state[7]) if state[7] is not None else None,
        "speed": float(state[9]) if state[9] is not None else None,
        "heading": float(state[10]) if state[10] is not None else None,
        "vertical_rate": _vertical_rate_ft_min(state),
        "departure_airport_code": LIVE_MARKER,
        "arrival_airport_code": "VHHH",
    }


def _last_track_id(conn: sqlite3.Connection, flight_id: str) -> int | None:
    row = conn.execute(
        """
        SELECT track_id FROM LNG_TRACKS
        WHERE flight_id = ? AND departure_airport_code = ?
        ORDER BY track_id DESC LIMIT 1
        """,
        (flight_id, LIVE_MARKER),
    ).fetchone()
    return int(row[0]) if row else None


def _insert_live_to_db(db_path: Path, states: list[list]) -> tuple[int, int]:
    if not db_path.parent.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    inserted = 0
    skipped = 0
    try:
        _ensure_tracks_table(conn)
        for raw in states[:MAX_AIRCRAFT_PER_TICK]:
            row = _parse_state(raw)
            if not row:
                skipped += 1
                continue
            flight_id = row["flight_id"]
            prev_id = _last_track_id(conn, flight_id)
            # 同一毫秒内重复写入时仍追加新点，避免尾迹停在原地不延长
            dup = conn.execute(
                """
                SELECT track_id FROM LNG_TRACKS
                WHERE flight_id = ? AND timestamp = ? AND departure_airport_code = ?
                LIMIT 1
                """,
                (flight_id, row["timestamp"], LIVE_MARKER),
            ).fetchone()
            if dup:
                row["timestamp"] = _utc_now_iso()
            cur = conn.execute(
                """
                INSERT INTO LNG_TRACKS (
                    timestamp, flight_id, tracks_latitude, tracks_longitude,
                    altitude, speed, heading, vertical_rate,
                    departure_airport_code, arrival_airport_code,
                    next_id, prev_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
                """,
                (
                    row["timestamp"],
                    flight_id,
                    row["tracks_latitude"],
                    row["tracks_longitude"],
                    row["altitude"],
                    row["speed"],
                    row["heading"],
                    row.get("vertical_rate"),
                    LIVE_MARKER,
                    row["arrival_airport_code"],
                    prev_id,
                ),
            )
            new_id = int(cur.lastrowid)
            if prev_id:
                conn.execute(
                    "UPDATE LNG_TRACKS SET next_id = ? WHERE track_id = ?",
                    (new_id, prev_id),
                )
            inserted += 1
        conn.commit()
    finally:
        conn.close()
    return inserted, skipped


def prune_live(conn_path: Path) -> int:
    if not conn_path.exists():
        return 0
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=PRUNE_MINUTES)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    conn = sqlite3.connect(conn_path)
    try:
        cur = conn.execute(
            """
            DELETE FROM LNG_TRACKS
            WHERE departure_airport_code = ?
              AND timestamp < ?
            """,
            (LIVE_MARKER, cutoff),
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def purge_demo_tracks(conn_path: Path) -> int:
    if not conn_path.exists():
        return 0
    conn = sqlite3.connect(conn_path)
    try:
        cur = conn.execute(
            f"""
            DELETE FROM LNG_TRACKS
            WHERE flight_id IN ({",".join("?" * len(DEMO_FLIGHT_IDS))})
            """,
            DEMO_FLIGHT_IDS,
        )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def run_once() -> dict[str, object]:
    try:
        states = fetch_states()
    except Exception as exc:  # noqa: BLE001
        return {"ok": 0, "error": str(exc), "opensky_count": 0}

    ins_a1, skip = _insert_live_to_db(A1_DB, states)
    if A5_DB.exists():
        ins_a5, _ = _insert_live_to_db(A5_DB, states)
    else:
        ins_a5, _, _ = sync_tracks(replace=False)

    demo_purged = 0
    if ins_a1 or ins_a5:
        demo_purged += purge_demo_tracks(A5_DB)
        demo_purged += purge_demo_tracks(A1_DB)

    pr_a1 = prune_live(A1_DB)
    pr_a5 = prune_live(A5_DB) if A5_DB.exists() else 0

    live_a5 = 0
    if A5_DB.exists():
        conn = sqlite3.connect(A5_DB)
        try:
            live_a5 = conn.execute(
                "SELECT COUNT(*) FROM LNG_TRACKS WHERE departure_airport_code = ?",
                (LIVE_MARKER,),
            ).fetchone()[0]
        finally:
            conn.close()

    return {
        "ok": 1,
        "opensky_count": len(states),
        "inserted_a1": ins_a1,
        "inserted_a5": ins_a5,
        "skipped": skip,
        "pruned_a1": pr_a1,
        "pruned_a5": pr_a5,
        "demo_purged": demo_purged,
        "live_a5_total": live_a5,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="A1 OpenSky 实时采集 → A5 地图")
    parser.add_argument("--once", action="store_true", help="只执行一轮")
    parser.add_argument("--interval", type=int, default=POLL_SECONDS, help="轮询秒数")
    args = parser.parse_args()

    if args.once:
        print(json.dumps(run_once(), ensure_ascii=False))
        return 0

    print(
        f"[A1 live] OpenSky → A1 + A5；每 {args.interval}s（Ctrl+C 停止）",
        flush=True,
    )
    print(
        "[A1 live] 若出现 Too many requests：关掉其它采集窗口，等待 3–5 分钟后再跑本窗口。",
        flush=True,
    )
    backoff = RATE_LIMIT_BACKOFF_START
    while True:
        out = run_once()
        if out.get("ok") != 1:
            err = str(out.get("error") or "")
            print(f"[A1 live] 失败: {err}", flush=True)
            if "too many" in err.lower():
                wait = min(backoff, RATE_LIMIT_BACKOFF_MAX)
                print(f"[A1 live] OpenSky 限流，{wait}s 后重试（勿开第二个采集进程）", flush=True)
                time.sleep(wait)
                backoff = min(backoff * 2, RATE_LIMIT_BACKOFF_MAX)
                continue
            time.sleep(max(10, args.interval))
        else:
            backoff = RATE_LIMIT_BACKOFF_START
            print(
                f"[A1 live] opensky={out['opensky_count']} "
                f"a5_live={out['live_a5_total']} demo_removed={out.get('demo_purged', 0)}",
                flush=True,
            )
            time.sleep(max(10, args.interval))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
