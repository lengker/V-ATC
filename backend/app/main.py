from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.dev import router as dev_router
from app.api.query import router as query_router
from app.api.tables import router as tables_router
from app.db.bootstrap import initialize_database
from app.db.connection import get_connection


@asynccontextmanager
async def lifespan(_: FastAPI):
    with get_connection() as conn:
        initialize_database(conn)
    yield


app = FastAPI(
    title="A5 Database Service",
    version="0.1.0",
    lifespan=lifespan,
)
# 浏览器从 localhost:3000 访问 127.0.0.1:8000 属于跨域，需放行开发源，否则前端 fetch 报 Failed to fetch
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    # 任意端口（如 3001）也放行，避免换端口后仍被拦
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(tables_router)
app.include_router(query_router)
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
    """根路径未挂页面，避免浏览器打开 8000 只看到 404。"""
    return RedirectResponse(url="/docs", status_code=307)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}
