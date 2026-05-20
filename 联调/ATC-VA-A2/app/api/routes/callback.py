from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import verify_a3_callback_token
from app.db.session import get_db
from app.schemas.callback import A3CallbackRequest, A3CallbackResponse
from app.services.a3_callback_service import A3CallbackService

router = APIRouter(prefix="/api/v1/a3", tags=["a3"])


@router.post(
    "/callback",
    summary="Receive A-3 preprocessing result callback",
    response_model=A3CallbackResponse,
    status_code=status.HTTP_201_CREATED,
)
async def a3_callback(
    payload: A3CallbackRequest,
    _: None = Depends(verify_a3_callback_token),
    db: AsyncSession = Depends(get_db),
) -> A3CallbackResponse:
    svc = A3CallbackService(db)
    return await svc.handle_callback(payload)
