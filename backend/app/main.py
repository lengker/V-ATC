from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
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
