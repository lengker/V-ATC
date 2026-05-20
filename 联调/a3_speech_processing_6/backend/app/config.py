from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    db_path: str
    environment: str

    @property
    def is_dev(self) -> bool:
        return self.environment.lower() in {"dev", "development", "local"}


def get_settings() -> Settings:
    default_db = Path(__file__).resolve().parents[1] / "data.sqlite3"
    return Settings(
        db_path=os.getenv("APP_DB_PATH", str(default_db)),
        environment=os.getenv("APP_ENV", "development"),
    )
