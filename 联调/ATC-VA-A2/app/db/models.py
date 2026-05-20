from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class VoiceFile(Base):
    __tablename__ = "t_a2_voice_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    track_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    icao_code: Mapped[str] = mapped_column(String(10), nullable=False, default="VHHH")
    start_time_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_time_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    status: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    last_access_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    a3_process_status: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)
    error_log: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    segments: Mapped[list[VoiceSegment]] = relationship(back_populates="voice_file", cascade="all, delete-orphan")


class VoiceSegment(Base):
    __tablename__ = "t_a2_voice_segments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    voice_file_id: Mapped[int] = mapped_column(ForeignKey("t_a2_voice_files.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    label_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    relative_start: Mapped[float] = mapped_column(Float, nullable=False)
    relative_end: Mapped[float] = mapped_column(Float, nullable=False)
    abs_start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    abs_end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    asr_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    annotation_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vad_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_annotated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    storage_tag: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    duration: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    model_info: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    voice_file: Mapped[VoiceFile] = relationship(back_populates="segments")


class StorageLog(Base):
    __tablename__ = "t_a2_storage_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    action_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_file_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    released_space: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    op_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
