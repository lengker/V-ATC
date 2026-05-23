"""元数据同步与修复服务。

数据库里记录的是“系统认为文件应该是什么样”，
而磁盘里的文件才是“真实存在的状态”。
这个服务负责定期对比两者，发现缺失或不一致时回写数据库。
"""

from __future__ import annotations

import hashlib
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from app.core.config import settings
from app.core.time_utils import utcnow_text
from app.repositories import VoiceRepository
from app.schemas import VoiceRecord


class MetadataSyncService:
    def __init__(self, repository: VoiceRepository | None = None) -> None:
        """允许注入 Repository，便于测试和复用。"""

        self.repository = repository or VoiceRepository()
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """启动后台同步线程。"""

        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="a2-metadata-sync")
        self._thread.start()

    def stop(self) -> None:
        """停止后台同步线程。"""

        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=2)

    def run_once(self) -> dict[str, int]:
        """执行一次全量扫描并修复元数据。"""

        imported = self._import_storage_files()
        records = self.repository.list_voice_records()
        missing = 0
        updated = 0
        for record in records:
            path = Path(record["file_path"])
            if not path.exists():
                self.repository.update_voice_status(record["unique_id"], valid_status="missing")
                missing += 1
                continue
            checksum = self._hash_file(path)
            size = path.stat().st_size
            status = "valid"
            if record.get("file_size") != size or record.get("checksum") != checksum or record.get("valid_status") != status:
                self.repository.update_voice_status(
                    record["unique_id"],
                    valid_status=status,
                    file_size=size,
                    checksum=checksum,
                )
                updated += 1

        orphans = 0

        return {"missing": missing, "updated": updated, "scanned": len(records), "orphansCleaned": orphans, "imported": imported}

    def _import_storage_files(self) -> int:
        data_root = settings.data_root
        if not data_root.exists():
            return 0

        candidates: list[tuple[Path, str, str, str, str, datetime]] = []
        for file_path in data_root.rglob("*"):
            if not file_path.is_file() or file_path.suffix.lower() not in (".wav", ".mp3", ".aac", ".ogg", ".string"):
                continue
            try:
                rel = file_path.relative_to(data_root)
            except ValueError:
                continue
            if len(rel.parts) < 4:
                continue

            icao_code = rel.parts[0].upper()
            band = rel.parts[1]
            stem = file_path.stem
            parts = stem.split("_")
            if len(parts) < 4:
                continue
            data_type = parts[-1] if parts[-1] in ("S", "H") else "S"
            timestamp = parts[1]
            try:
                start_dt = datetime.strptime(timestamp[:17], "%Y%m%d%H%M%S%f")
            except ValueError:
                continue
            unique_id = stem[: -(len(data_type) + 1)] if stem.endswith(f"_{data_type}") else stem
            candidates.append((file_path, unique_id, icao_code, band, data_type, start_dt))

        candidates.sort(key=lambda item: (item[2], item[3], item[5], item[0].name))
        imported = 0
        for index, (file_path, unique_id, icao_code, band, data_type, start_dt) in enumerate(candidates):
            resolved = str(file_path.resolve())
            if self.repository.voice_record_exists_by_path(resolved):
                continue

            end_dt = start_dt + timedelta(seconds=60)
            if index + 1 < len(candidates):
                _, _, next_icao, next_band, _, next_start = candidates[index + 1]
                if next_icao == icao_code and next_band == band and next_start > start_dt:
                    end_dt = next_start

            record = VoiceRecord(
                unique_id=unique_id,
                icao_code=icao_code,
                band=band,
                original_time=self._format_dt(start_dt),
                process_time=utcnow_text(),
                file_path=resolved,
                file_name=file_path.name,
                file_size=file_path.stat().st_size,
                data_type=data_type,  # type: ignore[arg-type]
                start_at=self._format_dt(start_dt),
                end_at=self._format_dt(end_dt),
                checksum=self._hash_file(file_path),
            )
            self.repository.insert_voice_record(record)
            imported += 1
        return imported

    def _clean_orphan_files(self) -> int:
        """扫描磁盘上 DB 没有记录的孤儿语音文件，予以删除。
        为防止误删正在写入的文件，仅删除创建时间超过 5 分钟的文件。"""
        import time as _time

        cleaned = 0
        data_root = settings.data_root
        if not data_root.exists():
            return 0
        min_mtime = _time.time() - 300
        for file_path in data_root.rglob("*"):
            if not file_path.is_file():
                continue
            suffix = file_path.suffix.lower()
            if suffix not in (".wav", ".mp3", ".aac"):
                continue
            try:
                if file_path.stat().st_mtime > min_mtime:
                    continue
                resolved = str(file_path.resolve())
            except OSError:
                continue
            if not self.repository.voice_record_exists_by_path(resolved):
                file_path.unlink(missing_ok=True)
                cleaned += 1
        return cleaned

    def _run_loop(self) -> None:
        """按配置的时间间隔循环执行同步。"""

        self.run_once()
        while not self._stop_event.wait(settings.sync_interval_seconds):
            self.run_once()

    @staticmethod
    def _hash_file(path: Path) -> str:
        """按块读取文件并计算 SHA-256，避免大文件一次性读入内存。"""

        hasher = hashlib.sha256()
        with path.open("rb") as file_obj:
            while True:
                chunk = file_obj.read(1024 * 256)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest()

    @staticmethod
    def _format_dt(value: datetime) -> str:
        return value.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
