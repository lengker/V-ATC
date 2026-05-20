from fastapi import APIRouter

from app.api.routes.admin import router as admin_router
from app.api.routes.a3_integration import router as a3_integration_router
from app.api.routes.a5_integration import router as a5_integration_router
from app.api.routes.audio import router as audio_router
from app.api.routes.callback import router as callback_router
from app.api.routes.health import router as health_router
from app.api.routes.ingestion import router as ingestion_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(audio_router)
api_router.include_router(callback_router)
api_router.include_router(ingestion_router)
api_router.include_router(a3_integration_router)
api_router.include_router(a5_integration_router)
api_router.include_router(admin_router)
