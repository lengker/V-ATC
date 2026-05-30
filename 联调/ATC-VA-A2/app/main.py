from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import init_database
from app.db.session import engine
from app.services.ingestion_scheduler import liveatc_scheduler


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_database(engine)
    if settings.a2_auto_start_scheduler:
        await liveatc_scheduler.start()
    yield
    await liveatc_scheduler.stop()


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router)

_audio_root = Path(settings.a2_audio_storage).resolve()
_audio_root.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(_audio_root)), name="a2-media")
