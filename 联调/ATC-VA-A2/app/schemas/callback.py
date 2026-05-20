from datetime import datetime

from pydantic import BaseModel, Field, model_validator


class A3SegmentPayload(BaseModel):
    relative_start: float = Field(..., ge=0)
    relative_end: float = Field(..., ge=0)
    asr_content: str | None = None
    vad_confidence: float | None = None
    model_info: str | None = None
    storage_tag: str | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "A3SegmentPayload":
        if self.relative_end <= self.relative_start:
            raise ValueError("relative_end must be greater than relative_start")
        return self


class A3CallbackRequest(BaseModel):
    voice_file_id: int = Field(..., description="t_a2_voice_files.id")
    process_status: int = Field(default=2, description="2: success, 3: failure")
    error_log: str | None = None
    segments: list[A3SegmentPayload] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_status(self) -> "A3CallbackRequest":
        if self.process_status not in (2, 3):
            raise ValueError("process_status must be 2 (success) or 3 (failure)")
        return self


class A3CallbackResponse(BaseModel):
    voice_file_id: int
    updated_at: datetime
    segment_count: int
