"""
定义数据库表结构 - 兼容 A5 系统标准与 A3 模块业务需求
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Text, ForeignKey, CheckConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base

class LngAirports(Base):
    """ LNG_AIRPORTS（机场表） """
    __tablename__ = "LNG_AIRPORTS"
    airport_code = Column(String(10), primary_key=True)
    name = Column(String(255), nullable=False)
    country_code = Column(String(3), nullable=True)
    airports_latitude = Column(Float, nullable=False)
    airports_longitude = Column(Float, nullable=False)

class LngUsers(Base):
    """ LNG_USERS（用户表） """
    __tablename__ = "LNG_USERS"
    user_id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=True)
    email = Column(String(255), nullable=True)

class LngTracks(Base):
    """ LNG_TRACKS（航迹表） """
    __tablename__ = "LNG_TRACKS"
    track_id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, nullable=False)
    flight_id = Column(String(20), nullable=False)
    tracks_latitude = Column(Float, nullable=False)
    tracks_longitude = Column(Float, nullable=False)
    altitude = Column(Float, nullable=True)
    speed = Column(Float, nullable=True)
    heading = Column(Float, nullable=True)
    departure_airport_code = Column(String(10), ForeignKey("LNG_AIRPORTS.airport_code"), nullable=True)
    arrival_airport_code = Column(String(10), ForeignKey("LNG_AIRPORTS.airport_code"), nullable=True)
    next_id = Column(Integer, ForeignKey("LNG_TRACKS.track_id"), nullable=True)
    prev_id = Column(Integer, ForeignKey("LNG_TRACKS.track_id"), nullable=True)

    departure_airport = relationship("LngAirports", foreign_keys=[departure_airport_code])
    arrival_airport = relationship("LngAirports", foreign_keys=[arrival_airport_code])
    next_track = relationship("LngTracks", foreign_keys=[next_id], remote_side=[track_id])
    prev_track = relationship("LngTracks", foreign_keys=[prev_id], remote_side=[track_id])

class LngAudioRecords(Base):
    """ LNG_AUDIO_RECORDS（音频表 - A3 核心表） """
    __tablename__ = "LNG_AUDIO_RECORDS"

    # 1. 主键映射：数据库列名设为 audio_id
    audio_id = Column("audio_id", Integer, primary_key=True, autoincrement=True)

    source_url = Column(String(500), nullable=True) # 本地处理暂设为 True
    start_time_utc = Column(DateTime, nullable=True)
    end_time_utc = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)     # 系统标准字段
    file_name = Column(String(255), nullable=False, index=True)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    status = Column(Integer, default=0)              # 0-待处理, 1-处理中, 2-已完成, 3-失败
    last_access_at = Column(DateTime, default=datetime.utcnow)

    # 加防宕机补丁加防宕机补丁
    # 当航迹被删时，音频的 track_id 自动置空，而不是报错
    track_id = Column(Integer, ForeignKey("LNG_TRACKS.track_id", ondelete="SET NULL"), nullable=True)
    next_id = Column(Integer, ForeignKey("LNG_AUDIO_RECORDS.audio_id"), nullable=True)
    prev_id = Column(Integer, ForeignKey("LNG_AUDIO_RECORDS.audio_id"), nullable=True)

    track = relationship("LngTracks")
    next_audio = relationship("LngAudioRecords", foreign_keys=[next_id], remote_side=[audio_id])
    prev_audio = relationship("LngAudioRecords", foreign_keys=[prev_id], remote_side=[audio_id])

    __table_args__ = (
        CheckConstraint('status IN (0, 1, 2, 3)', name='check_audio_status'),
    )

class LngAnnotations(Base):
    """ LNG_ANNOTATIONS（标注表） """
    __tablename__ = "LNG_ANNOTATIONS"
    annotation_id = Column(Integer, primary_key=True, autoincrement=True)
    label_type = Column(String(100), nullable=True)
    author_id = Column(Integer, ForeignKey("LNG_USERS.user_id"), nullable=True)
    # 加防宕机补丁加防宕机补丁
    # 当音频被删时，附属的标注数据必须被级联删除，防止脏读
    audio_id = Column(Integer, ForeignKey("LNG_AUDIO_RECORDS.audio_id", ondelete="CASCADE"), nullable=False)
    relative_start = Column(Float, nullable=False)
    relative_end = Column(Float, nullable=False)
    abs_start_time = Column(DateTime, nullable=False)
    abs_end_time = Column(DateTime, nullable=False)
    asr_content = Column(Text, nullable=True)
    vad_confidence = Column(Float, nullable=True)
    is_annotated = Column(Integer, default=0)
    annotation_text = Column(Text, nullable=True)
    annotation_time = Column(DateTime, nullable=True)
    storage_tag = Column(String(100), nullable=True)
    next_id = Column(Integer, ForeignKey("LNG_ANNOTATIONS.annotation_id"), nullable=True)
    prev_id = Column(Integer, ForeignKey("LNG_ANNOTATIONS.annotation_id"), nullable=True)

    author = relationship("LngUsers")
    audio = relationship("LngAudioRecords")

    __table_args__ = (
        CheckConstraint('relative_start <= relative_end', name='check_relative_time_range'),
        CheckConstraint('is_annotated IN (0, 1)', name='check_is_annotated'),
    )

class LngVspData(Base):
    """ LNG_VSP_DATA（VSP数据表） """
    __tablename__ = "LNG_VSP_DATA"
    vsp_id = Column(Integer, primary_key=True, autoincrement=True)
    airport_code = Column(String(10), ForeignKey("LNG_AIRPORTS.airport_code"), nullable=False)
    region = Column(String(100), nullable=True)
    runway = Column(String(50), nullable=True)
    sector_name = Column(String(100), nullable=True)
    airport = relationship("LngAirports")

class LngStorageLog(Base):
    """ LNG_STORAGE_LOG（存储日志表） """
    __tablename__ = "LNG_STORAGE_LOG"
    id = Column(Integer, primary_key=True, autoincrement=True)
    action_type = Column(String(20), nullable=False)
    source_url = Column(String(500), nullable=False)
    released_space = Column(Integer, nullable=False)
    op_time = Column(DateTime, default=datetime.utcnow, nullable=False)
