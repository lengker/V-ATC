from fastapi import APIRouter

from app.core.config import settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("", summary="Service health check")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name, "env": settings.app_env}
