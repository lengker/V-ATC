from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.dev import router as dev_router
from app.api.auth import router as auth_router
from app.api.query import router as query_router
from app.api.tables import router as tables_router
from app.db.bootstrap import initialize_database
from app.db.connection import get_connection


@asynccontextmanager
async def lifespan(_: FastAPI):
    with get_connection() as conn:
        initialize_database(conn)
    try:
        import sys
        from pathlib import Path

        lian_diao = Path(__file__).resolve().parents[2] / "联调"
        if str(lian_diao) not in sys.path:
            sys.path.insert(0, str(lian_diao))
        # 启动时不自动 purge：避免删掉尚未 ASR 的待转写录音
    except Exception:
        pass
    yield


app = FastAPI(
    title="A5 Database Service",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(tables_router)
app.include_router(query_router)
app.include_router(auth_router)
app.include_router(dev_router)

_static_dir = Path(__file__).resolve().parent / "static"
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount(
    "/static",
    StaticFiles(directory=str(_static_dir)),
    name="static",
)


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse(url="/docs", status_code=307)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/sync/a2-to-a5")
def sync_a2_to_a5(
    full: bool = Query(False),
    download: bool = Query(True),
    a3_limit: int = Query(8, ge=0, le=20),
) -> dict[str, object]:
    """联调：可选触发 A2 下载 → 扫描落盘 mp3 → 同步 A5 → A3 ASR（仅 download=true 且 a3_limit>0）。"""
    import sys
    from pathlib import Path

    lian_diao = Path(__file__).resolve().parents[2] / "联调"
    if str(lian_diao) not in sys.path:
        sys.path.insert(0, str(lian_diao))
    from refresh_recordings_pipeline import run_pipeline  # noqa: WPS433

    return run_pipeline(full=full, download=download, a3_limit=a3_limit)


@app.post("/sync/a1-to-a5")
def sync_a1_to_a5() -> dict[str, object]:
    """联调：A1 库 LNG_TRACKS 增量同步到 A5（供采集器或前端触发）。"""
    import sys
    from pathlib import Path

    lian_diao = Path(__file__).resolve().parents[2] / "联调"
    if str(lian_diao) not in sys.path:
        sys.path.insert(0, str(lian_diao))
    from sync_a1_db_to_a5 import sync_tracks  # noqa: WPS433

    inserted, total_a5, total_a1 = sync_tracks(replace=False)
    return {"ok": 1, "inserted": inserted, "a5_total": total_a5, "a1_total": total_a1}


@app.get("/tracks/live")
def list_live_tracks(
    limit: int = Query(30_000, ge=1, le=50_000),
    hours: float = Query(4.0, ge=0.5, le=24.0),
) -> list[dict[str, object]]:
    """OpenSky 实时航迹全路径（按航班+时间升序，供地图画完整尾迹）。"""
    from datetime import datetime, timedelta, timezone

    from app.db.connection import get_connection

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT track_id, timestamp, flight_id, tracks_latitude, tracks_longitude,
                   altitude, speed, heading, vertical_rate,
                   departure_airport_code, arrival_airport_code,
                   next_id, prev_id
            FROM LNG_TRACKS
            WHERE departure_airport_code = 'LIVE'
              AND timestamp >= ?
            ORDER BY timestamp DESC, track_id DESC
            LIMIT ?
            """,
            (cutoff, limit),
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/sync/a1-live-once")
def sync_a1_live_once() -> dict[str, object]:
    """拉取一轮 OpenSky（香港 bbox）→ A1 → 同步 A5（前端地图轮询可调用）。"""
    import sys
    from pathlib import Path

    lian_diao = Path(__file__).resolve().parents[2] / "联调"
    if str(lian_diao) not in sys.path:
        sys.path.insert(0, str(lian_diao))
    from a1_live_collector import run_once  # noqa: WPS433

    return run_once()


@app.post("/sync/a3-asr")
def sync_a3_asr(
    audio_id: int | None = Query(None, description="指定 A5 audio_id；不传则处理最近无 ASR 的录音"),
    limit: int = Query(3, ge=1, le=20),
) -> dict[str, object]:
    """对尚无转写的 A2 录音跑 A3（Windows 默认 Whisper）。"""
    import os
    import sys
    from pathlib import Path

    os.environ.setdefault("ASR_BACKEND", "faster_whisper")
    os.environ.setdefault("WHISPER_MODEL", "tiny")

    lian_diao = Path(__file__).resolve().parents[2] / "联调"
    if str(lian_diao) not in sys.path:
        sys.path.insert(0, str(lian_diao))
    from process_a2_via_a3 import run_a3_asr_for_a5, run_a3_asr_for_audio_id  # noqa: WPS433

    if audio_id is not None:
        return run_a3_asr_for_audio_id(audio_id=audio_id)
    return run_a3_asr_for_a5(limit=limit, replace_demo=False)
