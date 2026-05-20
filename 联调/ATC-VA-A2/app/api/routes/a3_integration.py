"""
A-3 Integration Routes

API endpoints for coordinating with A-3 preprocessing module:
- Request processing
- Check status
- Retry failed processing
- Monitor processing queue
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import verify_a3_callback_token
from app.db.session import get_db
from app.schemas.a3_integration import (
    A3AnnotationSyncResponse,
    A3ProcessingQueueResponse,
    A3ProcessingRequest,
    A3ProcessingResponse,
    A3ProcessingStatusResponse,
    A3RetryRequest,
    A3RetryResponse,
)
from app.services.a3_integration_service import A3IntegrationService

router = APIRouter(prefix="/api/v1/a3", tags=["a3-integration"])


@router.post(
    "/request-processing",
    summary="Request A-3 preprocessing for a voice file",
    response_model=A3ProcessingResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def request_a3_processing(
    payload: A3ProcessingRequest,
    _: None = Depends(verify_a3_callback_token),
    db: AsyncSession = Depends(get_db),
) -> A3ProcessingResponse:
    """
    Trigger A-3 preprocessing for a voice file.

    This endpoint marks a voice file for A-3 preprocessing and notifies
    the A-3 module to begin processing. The actual processing happens
    asynchronously, with results returned via the callback endpoint.

    RQ-A-3-10: Request A-3 to process a VoiceFile.
    """
    svc = A3IntegrationService(db)
    result = await svc.request_processing(payload.voice_file_id)
    return A3ProcessingResponse(**result)


@router.get(
    "/status/{voice_file_id}",
    summary="Get A-3 processing status",
    response_model=A3ProcessingStatusResponse,
    status_code=status.HTTP_200_OK,
)
async def get_a3_status(
    voice_file_id: int,
    db: AsyncSession = Depends(get_db),
) -> A3ProcessingStatusResponse:
    """
    Get current A-3 preprocessing status for a voice file.

    Returns the processing state (not_started, processing, completed, failed),
    segment count, and any error details.

    RQ-A-3-30: Query processing status and results.
    """
    svc = A3IntegrationService(db)
    result = await svc.get_processing_status(voice_file_id)
    return A3ProcessingStatusResponse(**result)


@router.post(
    "/retry/{voice_file_id}",
    summary="Retry failed A-3 processing",
    response_model=A3RetryResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_a3_processing(
    voice_file_id: int,
    payload: A3RetryRequest = None,
    _: None = Depends(verify_a3_callback_token),
    db: AsyncSession = Depends(get_db),
) -> A3RetryResponse:
    """
    Retry A-3 preprocessing with exponential backoff.

    Attempts to reprocess a voice file that previously failed.
    Implements exponential backoff to avoid overwhelming the A-3 module.

    RQ-A-3-40 integration: Implement retry logic.
    """
    attempt = payload.attempt if payload else 0
    svc = A3IntegrationService(db)
    result = await svc.retry_processing(voice_file_id, attempt)
    return A3RetryResponse(**result)


@router.post(
    "/sync-annotations/{voice_file_id}",
    summary="Synchronize segment annotation status",
    response_model=A3AnnotationSyncResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_a3_annotations(
    voice_file_id: int,
    db: AsyncSession = Depends(get_db),
) -> A3AnnotationSyncResponse:
    """
    Synchronize annotation status from A-3 processing results.

    Marks segments as ready for human annotation based on A-3 output completeness.
    """
    svc = A3IntegrationService(db)
    result = await svc.sync_annotation_status(voice_file_id)
    return A3AnnotationSyncResponse(**result)


@router.get(
    "/queue",
    summary="List A-3 processing queue",
    response_model=A3ProcessingQueueResponse,
    status_code=status.HTTP_200_OK,
)
async def get_a3_queue(
    status_filter: int | None = Query(None, ge=0, le=3, description="Filter by a3_process_status"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> A3ProcessingQueueResponse:
    """
    List voice files in A-3 processing queue.

    Returns files ordered by creation time, optionally filtered by processing status.

    Status codes:
    - 0: not_started
    - 1: processing
    - 2: completed
    - 3: failed
    """
    svc = A3IntegrationService(db)
    result = await svc.list_processing_queue(status_filter, limit)
    return A3ProcessingQueueResponse(**result)
