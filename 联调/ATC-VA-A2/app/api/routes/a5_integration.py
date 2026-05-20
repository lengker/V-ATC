"""
A-5 Integration Routes

API endpoints for coordinating with A-5 database module:
- Query audio by track ID
- Query audio by annotator
- Sync annotations to/from A-5
- Cross-module reporting
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import verify_api_token
from app.db.session import get_db
from app.schemas.a5_integration import (
    AnnotationSyncRequest,
    AnnotationSyncResponse,
    AnnotationSyncToA5Response,
    AudioByAnnotatorResponse,
    AudioByTrackResponse,
    CrossModuleReport,
    TrackMetadataResponse,
    UserMetadataResponse,
)
from app.services.a5_integration_service import A5IntegrationService

router = APIRouter(prefix="/api/v1", tags=["a5-integration"])


@router.get(
    "/tracks/{track_id}/metadata",
    summary="Get track metadata from A-5",
    response_model=TrackMetadataResponse,
    status_code=status.HTTP_200_OK,
)
async def get_track_metadata(
    track_id: int,
    db: AsyncSession = Depends(get_db),
) -> TrackMetadataResponse:
    """
    Retrieve track/flight metadata from A-5 database.

    In production, this queries A-5's track/flight information
    to correlate with audio segments.

    RQ-A-5-50: Link with A-5 for track metadata.
    """
    svc = A5IntegrationService(db)
    result = await svc.get_track_metadata(track_id)
    return TrackMetadataResponse(**result)


@router.get(
    "/users/{author_id}/metadata",
    summary="Get user/annotator metadata from A-5",
    response_model=UserMetadataResponse,
    status_code=status.HTTP_200_OK,
)
async def get_user_metadata(
    author_id: int,
    db: AsyncSession = Depends(get_db),
) -> UserMetadataResponse:
    """
    Retrieve user/annotator metadata from A-5 database.

    Returns information about the user who annotated segments.

    RQ-A-5-40: Link with A-5 for user info.
    """
    svc = A5IntegrationService(db)
    result = await svc.get_user_metadata(author_id)
    return UserMetadataResponse(**result)


@router.get(
    "/audio/by-track/{track_id}",
    summary="List audio segments by track ID",
    response_model=AudioByTrackResponse,
    status_code=status.HTTP_200_OK,
)
async def list_audio_by_track(
    track_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> AudioByTrackResponse:
    """
    List all audio segments associated with a specific flight track.

    Queries the A-2 database for voice files linked to a track_id
    from the A-1 module. Returns file metadata and annotation status.

    RQ-A-2-40 + A-5 integration: Query segments by track.
    """
    svc = A5IntegrationService(db)
    result = await svc.list_audio_by_track(track_id, limit)
    return AudioByTrackResponse(**result)


@router.get(
    "/audio/by-annotator/{author_id}",
    summary="List audio segments by annotator",
    response_model=AudioByAnnotatorResponse,
    status_code=status.HTTP_200_OK,
)
async def list_audio_by_annotator(
    author_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
) -> AudioByAnnotatorResponse:
    """
    List all audio segments annotated by a specific user.

    Returns segments where the user has completed annotation,
    including ASR and manual corrections.

    RQ-A-2-40 + A-5 integration: Query segments by annotator.
    """
    svc = A5IntegrationService(db)
    result = await svc.list_audio_by_annotator(author_id, limit)
    return AudioByAnnotatorResponse(**result)


@router.post(
    "/a5/sync-annotations-to-a5/{voice_file_id}",
    summary="Sync annotations to A-5 database",
    response_model=AnnotationSyncToA5Response,
    status_code=status.HTTP_200_OK,
)
async def sync_annotations_to_a5(
    voice_file_id: int,
    _: None = Depends(verify_api_token),
    db: AsyncSession = Depends(get_db),
) -> AnnotationSyncToA5Response:
    """
    Synchronize annotations to A-5 database.

    Exports completed annotations back to A-5 as the source of truth
    for the annotation data.

    RQ-A-5-50: Push annotation data to A-5.
    """
    svc = A5IntegrationService(db)
    result = await svc.sync_annotations_to_a5(voice_file_id)
    return AnnotationSyncToA5Response(**result)


@router.post(
    "/a5/sync-annotations-from-a5/{voice_file_id}",
    summary="Sync annotations from A-5 database",
    response_model=AnnotationSyncResponse,
    status_code=status.HTTP_200_OK,
)
async def sync_annotations_from_a5(
    voice_file_id: int,
    payload: AnnotationSyncRequest,
    _: None = Depends(verify_api_token),
    db: AsyncSession = Depends(get_db),
) -> AnnotationSyncResponse:
    """
    Receive and apply annotation updates from A-5 database.

    Updates segment annotations based on A-5 as the source of truth.
    Useful for syncing changes made by other tools/modules.

    RQ-A-5-50: Pull annotation updates from A-5.
    """
    svc = A5IntegrationService(db)
    result = await svc.sync_annotations_from_a5(voice_file_id, payload.model_dump())
    return AnnotationSyncResponse(**result)


@router.get(
    "/a5/cross-module-report",
    summary="Generate cross-module system report",
    response_model=CrossModuleReport,
    status_code=status.HTTP_200_OK,
)
async def get_cross_module_report(
    start_time: str = Query(..., description="ISO format datetime"),
    end_time: str = Query(..., description="ISO format datetime"),
    db: AsyncSession = Depends(get_db),
) -> CrossModuleReport:
    """
    Generate a cross-module report combining A-2, A-3, and A-5 data.

    Provides system status over a time range: file counts, processing stats,
    annotation rates, etc.

    RQ-A-5-50: Provide aggregated system status.
    """
    start = datetime.fromisoformat(start_time)
    end = datetime.fromisoformat(end_time)

    svc = A5IntegrationService(db)
    result = await svc.get_cross_module_report(start, end)
    return CrossModuleReport(**result)
