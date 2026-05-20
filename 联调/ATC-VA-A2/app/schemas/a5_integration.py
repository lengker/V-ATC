"""
A-5 Integration Request/Response Schemas

Defines data structures for A-5 database module coordination.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class TrackMetadataResponse(BaseModel):
    """Track metadata from A-5 database."""

    track_id: int
    flight_number: str
    aircraft_type: str
    callsign: str
    departure: str
    arrival: str
    timestamp: str


class UserMetadataResponse(BaseModel):
    """User/Annotator metadata from A-5 database."""

    author_id: int
    username: str
    email: str
    role: str
    active: bool
    created_at: str


class AudioFileItem(BaseModel):
    """Audio file with segment info."""

    voice_file_id: int
    file_name: str
    track_id: int | None = None
    start_time_utc: str
    end_time_utc: str
    file_size: int | None = None
    segment_count: int
    annotated_count: int
    a3_process_status: int
    source_url: str | None = None


class AudioByTrackResponse(BaseModel):
    """Response for querying audio by track ID."""

    track_id: int
    file_count: int
    files: list[AudioFileItem]


class SegmentItem(BaseModel):
    """Segment with annotation metadata."""

    segment_id: int
    voice_file_id: int
    file_name: str
    author_id: int | None = None
    abs_start_time: str
    abs_end_time: str
    duration: float | None = None
    asr_content: str | None = None
    annotation_text: str | None = None
    is_annotated: bool
    label_type: str | None = None


class AudioByAnnotatorResponse(BaseModel):
    """Response for querying audio by annotator."""

    author_id: int
    annotation_count: int
    segments: list[SegmentItem]


class AnnotationSyncRequest(BaseModel):
    """Request to sync annotations from A-5."""

    voice_file_id: int = Field(..., description="t_a2_voice_files.id")
    annotations: list[dict] = Field(default_factory=list, description="Annotation data from A-5")


class AnnotationSyncResponse(BaseModel):
    """Response after syncing annotations."""

    voice_file_id: int
    updated_count: int
    message: str
    timestamp: str


class AnnotationSyncToA5Response(BaseModel):
    """Response after syncing to A-5."""

    voice_file_id: int
    total_segments: int
    synced_count: int
    message: str
    timestamp: str


class CrossModuleReport(BaseModel):
    """Cross-module system status report."""

    time_range: dict = Field(description="Start and end timestamps")
    file_count: int
    processed_files: int
    failed_files: int
    total_segments: int
    annotated_segments: int
    annotation_rate: float
    generated_at: str
