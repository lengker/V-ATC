"""各模块 SQLite 路径（联调统一入口）。"""
from __future__ import annotations

from pathlib import Path

QT_ROOT = Path(__file__).resolve().parent.parent
LIAN_DIAO = QT_ROOT / "联调"

A2_DB = LIAN_DIAO / "ATC-VA-A2" / "a2_voice.db"
A2_ROOT = LIAN_DIAO / "ATC-VA-A2"
A3_ROOT = LIAN_DIAO / "a3_speech_processing_6"
A1_DB = LIAN_DIAO / "ATC-ADSB-Receiver" / "backend" / "backend" / "app" / "data.sqlite3"
A5_DB = QT_ROOT / "backend" / "data.sqlite3"
# start-all.ps1 将 A3 DATABASE_URL 指向 A5 库
A3_DB = A5_DB if A5_DB.exists() else (A3_ROOT / "backend" / "data.sqlite3")

A5_BASE = "http://127.0.0.1:8000"
A2_BASE = "http://127.0.0.1:8001"
A3_BASE = "http://127.0.0.1:9002"
A2_MEDIA_BASE = "http://127.0.0.1:8001/media"
A3_MEDIA_BASE = "http://127.0.0.1:9002/media"
