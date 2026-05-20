from __future__ import annotations

import sqlite3
from typing import Any

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_AIRPORTS"
PK_COLUMN = "airport_code"
WRITABLE_COLUMNS = {
    "airport_code",
    "name",
    "country_code",
    "airports_latitude",
    "airports_longitude",
}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    airport_code TEXT PRIMARY KEY,
    name TEXT,
    country_code TEXT,
    airports_latitude REAL,
    airports_longitude REAL
);
"""


def create_table(conn: sqlite3.Connection) -> None:
    conn.execute(CREATE_SQL)


def reset_table_data(conn: sqlite3.Connection) -> None:
    conn.execute(f"DELETE FROM {TABLE_NAME};")


def create_item(conn: sqlite3.Connection, payload: dict[str, Any]) -> str:
    if "airport_code" not in payload:
        raise ValueError("airport_code is required.")
    create_row(conn, TABLE_NAME, payload, WRITABLE_COLUMNS)
    return str(payload["airport_code"])


def get_item(conn: sqlite3.Connection, item_id: str) -> dict[str, Any] | None:
    return get_row(conn, TABLE_NAME, PK_COLUMN, item_id)


def list_items(conn: sqlite3.Connection, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    return list_rows(conn, TABLE_NAME, limit, offset)


def update_item(conn: sqlite3.Connection, item_id: str, payload: dict[str, Any]) -> bool:
    data = {k: v for k, v in payload.items() if k != PK_COLUMN}
    return update_row(conn, TABLE_NAME, PK_COLUMN, item_id, data, WRITABLE_COLUMNS - {PK_COLUMN})


def delete_item(conn: sqlite3.Connection, item_id: str) -> bool:
    return delete_row(conn, TABLE_NAME, PK_COLUMN, item_id)
