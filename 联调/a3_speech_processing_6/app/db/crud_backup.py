"""
数据库 CRUD 操作 - 适配新数据库设计
"""
from sqlalchemy.orm import Session
from sqlalchemy import and_
from datetime import datetime
from typing import List, Optional

from app.db.models import (
    LngAirports, LngUsers, LngTracks, LngAudioRecords, 
    LngAnnotations, LngVspData, LngStorageLog
)


# LNG_AIRPORTS CRUD
def create_airport(db: Session, airport_data: dict) -> LngAirports:
    """创建机场记录"""
    db_airport = LngAirports(**airport_data)
    db.add(db_airport)
    db.commit()
    db.refresh(db_airport)
    return db_airport


def get_airport(db: Session, airport_code: str) -> Optional[LngAirports]:
    """根据机场代码获取机场信息"""
    return db.query(LngAirports).filter(LngAirports.airport_code == airport_code).first()


def get_airports(db: Session, skip: int = 0, limit: int = 100) -> List[LngAirports]:
    """获取机场列表"""
    return db.query(LngAirports).offset(skip).limit(limit).all()


# LNG_USERS CRUD
def create_user(db: Session, user_data: dict) -> LngUsers:
    """创建用户记录"""
    db_user = LngUsers(**user_data)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


def get_user(db: Session, user_id: int) -> Optional[LngUsers]:
    """根据用户ID获取用户信息"""
    return db.query(LngUsers).filter(LngUsers.user_id == user_id).first()


def get_user_by_username(db: Session, username: str) -> Optional[LngUsers]:
    """根据用户名获取用户信息"""
    return db.query(LngUsers).filter(LngUsers.username == username).first()


def get_users(db: Session, skip: int = 0, limit: int = 100) -> List[LngUsers]:
    """获取用户列表"""
    return db.query(LngUsers).offset(skip).limit(limit).all()


# LNG_TRACKS CRUD
def create_track(db: Session, track_data: dict) -> LngTracks:
    """创建航迹记录"""
    db_track = LngTracks(**track_data)
    db.add(db_track)
    db.commit()
    db.refresh(db_track)
    return db_track


def get_track(db: Session, track_id: int) -> Optional[LngTracks]:
    """根据航迹ID获取航迹信息"""
    return db.query(LngTracks).filter(LngTracks.track_id == track_id).first()


def get_tracks_by_time_range(db: Session, start_time: datetime, end_time: datetime, skip: int = 0, limit: int = 100) -> List[LngTracks]:
    """根据时间范围获取航迹列表"""
    return db.query(LngTracks).filter(
        and_(
            LngTracks.timestamp >= start_time,
            LngTracks.timestamp <= end_time
        )
    ).offset(skip).limit(limit).all()


def get_tracks_by_flight_id(db: Session, flight_id: str) -> List[LngTracks]:
    """根据航班ID获取航迹列表"""
    return db.query(LngTracks).filter(LngTracks.flight_id == flight_id).all()


# LNG_AUDIO_RECORDS CRUD
def create_audio_record(db: Session, audio_data: dict) -> LngAudioRecords:
    """创建音频记录"""
    db_audio = LngAudioRecords(**audio_data)
    db.add(db_audio)
    db.commit()
    db.refresh(db_audio)
    return db_audio


def get_audio_record(db: Session, audio_id: int) -> Optional[LngAudioRecords]:
    """根据音频ID获取音频信息"""
    return db.query(LngAudioRecords).filter(LngAudioRecords.audio_id == audio_id).first()


def get_audio_records_by_time_range(db: Session, start_time: datetime, end_time: datetime, skip: int = 0, limit: int = 100) -> List[LngAudioRecords]:
    """根据时间范围获取音频记录列表"""
    return db.query(LngAudioRecords).filter(
        and_(
            LngAudioRecords.start_time_utc >= start_time,
            LngAudioRecords.end_time_utc <= end_time
        )
    ).offset(skip).limit(limit).all()


def get_audio_records_by_track(db: Session, track_id: int) -> List[LngAudioRecords]:
    """根据航迹ID获取音频记录列表"""
    return db.query(LngAudioRecords).filter(LngAudioRecords.track_id == track_id).all()


def get_audio_records_by_strategy(
        db: Session,
        start_time: datetime,
        end_time: datetime,
        keyword: Optional[str] = None,
        skip: int = 0,
        limit: int = 1000
) -> List[LngAudioRecords]:
    """
    策略检索：按时间范围、文本关键字对音频记录进行检索
    """
    query = db.query(LngAudioRecords).filter(
        and_(
            LngAudioRecords.start_time_utc >= start_time,
            LngAudioRecords.end_time_utc <= end_time
        )
    )

    if keyword:
        query = query.filter(LngAudioRecords.file_name.ilike(f"%{keyword}%") | 
                           LngAudioRecords.source_url.ilike(f"%{keyword}%"))

    return query.offset(skip).limit(limit).all()


# LNG_ANNOTATIONS CRUD
def create_annotation(db: Session, annotation_data: dict) -> LngAnnotations:
    """创建标注记录"""
    db_annotation = LngAnnotations(**annotation_data)
    db.add(db_annotation)
    db.commit()
    db.refresh(db_annotation)
    return db_annotation


def get_annotation(db: Session, annotation_id: int) -> Optional[LngAnnotations]:
    """根据标注ID获取标注信息"""
    return db.query(LngAnnotations).filter(LngAnnotations.annotation_id == annotation_id).first()


def get_annotations_by_audio(db: Session, audio_id: int) -> List[LngAnnotations]:
    """根据音频ID获取标注列表"""
    return db.query(LngAnnotations).filter(LngAnnotations.audio_id == audio_id).all()


def get_annotations_by_author(db: Session, author_id: int) -> List[LngAnnotations]:
    """根据作者ID获取标注列表"""
    return db.query(LngAnnotations).filter(LngAnnotations.author_id == author_id).all()


def get_annotations_by_time_range(db: Session, start_time: datetime, end_time: datetime) -> List[LngAnnotations]:
    """根据时间范围获取标注列表"""
    return db.query(LngAnnotations).filter(
        and_(
            LngAnnotations.abs_start_time >= start_time,
            LngAnnotations.abs_end_time <= end_time
        )
    ).all()


# LNG_VSP_DATA CRUD
def create_vsp_data(db: Session, vsp_data: dict) -> LngVspData:
    """创建VSP数据记录"""
    db_vsp = LngVspData(**vsp_data)
    db.add(db_vsp)
    db.commit()
    db.refresh(db_vsp)
    return db_vsp


def get_vsp_data_by_airport(db: Session, airport_code: str) -> List[LngVspData]:
    """根据机场代码获取VSP数据列表"""
    return db.query(LngVspData).filter(LngVspData.airport_code == airport_code).all()


# LNG_STORAGE_LOG CRUD
def create_storage_log(db: Session, log_data: dict) -> LngStorageLog:
    """创建存储日志记录"""
    db_log = LngStorageLog(**log_data)
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log


def get_storage_logs_by_time_range(db: Session, start_time: datetime, end_time: datetime) -> List[LngStorageLog]:
    """根据时间范围获取存储日志列表"""
    return db.query(LngStorageLog).filter(
        and_(
            LngStorageLog.op_time >= start_time,
            LngStorageLog.op_time <= end_time
        )
    ).all()