from __future__ import annotations

from app.tables import (
    lng_airports,
    lng_annotations,
    lng_audio_records,
    lng_storage_log,
    lng_tracks,
    lng_users,
    lng_vsp_data,
)

TABLE_MODULES = {
    "airports": lng_airports,
    "users": lng_users,
    "tracks": lng_tracks,
    "audio_records": lng_audio_records,
    "annotations": lng_annotations,
    "vsp_data": lng_vsp_data,
    "storage_log": lng_storage_log,
}

CREATION_ORDER = [
    "airports",
    "users",
    "tracks",
    "audio_records",
    "annotations",
    "vsp_data",
    "storage_log",
]
