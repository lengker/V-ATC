"""
A-3 Integration Request/Response Schemas

Defines data structures for A-3 preprocessing module coordination.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class A3ProcessingStatusResponse(BaseModel):
    """Response for A-3 processing status query."""

    voice_file_id: int
    file_name: str
    a3_process_status: int = Field(description="0: not_started, 1: processing, 2: completed, 3: failed")
    status_text: str = Field(description="Human-readable status")
    segment_count: int = Field(description="Total segments in this file")
    annotated_count: int = Field(description="Already annotated segments")
    error_log: str | None = Field(default=None, description="Error details if failed")
    updated_at: str = Field(description="ISO format timestamp")


class A3ProcessingRequest(BaseModel):
    """Request to trigger A-3 processing."""

    voice_file_id: int = Field(..., description="t_a2_voice_files.id")


class A3ProcessingResponse(BaseModel):
    """Response after requesting A-3 processing."""

    voice_file_id: int
    status: int = Field(description="A-3 process status")
    file_name: str | None = None
    start_time_utc: str | None = None
    end_time_utc: str | None = None
    message: str


class A3RetryRequest(BaseModel):
    """Request to retry A-3 processing."""

    voice_file_id: int = Field(..., description="t_a2_voice_files.id")
    attempt: int = Field(default=0, ge=0, le=5, description="Current attempt number")


class A3RetryResponse(BaseModel):
    """Response after retry request."""

    voice_file_id: int
    attempt: int
    delay_seconds: float
    status: int
    message: str


class A3AnnotationSyncResponse(BaseModel):
    """Response for annotation status sync."""

    voice_file_id: int
    total_segments: int
    ready_for_annotation: int
    already_annotated: int
    pending_asr: int


class A3QueueItem(BaseModel):
    """Item in A-3 processing queue."""

    voice_file_id: int
    file_name: str
    a3_process_status: int
    status_text: str
    created_at: str


class A3ProcessingQueueResponse(BaseModel):
    """Response containing A-3 processing queue."""

    queue_size: int
    items: list[A3QueueItem]
