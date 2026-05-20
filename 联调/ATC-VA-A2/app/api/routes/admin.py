from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services.storage_service import StorageManagerService

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.post("/cleanup", summary="Run storage LRU cleanup")
async def cleanup_storage(db: AsyncSession = Depends(get_db)) -> dict[str, int | bool]:
    svc = StorageManagerService(db)
    need_cleanup = await svc.needs_cleanup()
    deleted = await svc.cleanup_lru_files() if need_cleanup else 0
    return {"need_cleanup": need_cleanup, "deleted_files": deleted}
