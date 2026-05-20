from datetime import datetime

from pydantic import BaseModel, Field


class AudioQueryRequest(BaseModel):
    start_time_utc: datetime = Field(..., description="UTC start time")
    end_time_utc: datetime = Field(..., description="UTC end time")


class AudioSliceMetadata(BaseModel):
    segment_id: int
    voice_file_id: int
    file_path: str
    relative_start: float
    relative_end: float
    abs_start_time: datetime
    abs_end_time: datetime
