from __future__ import annotations

from datetime import datetime, timezone


def utc_datetime(
    year: int,
    month: int,
    day: int,
    hour: int = 0,
    minute: int = 0,
    second: int = 0,
) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


def jan1_2024_utc(hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    return utc_datetime(2024, 1, 1, hour, minute, second)
