from __future__ import annotations

import sqlite3
from typing import Any

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_VSP_DATA"
PK_COLUMN = "vsp_id"
WRITABLE_COLUMNS = {
    "airport_code",
    "region",
    "runway",
    "taxiway",
    "vor_id",
    "waypoint",
    "approach_type",
    "gate",
    "holding_point",
    "sector_name",
}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    vsp_id INTEGER PRIMARY KEY AUTOINCREMENT,
    airport_code TEXT NOT NULL,
    region TEXT,
    runway TEXT,
    taxiway TEXT,
    vor_id TEXT,
    waypoint TEXT,
    approach_type TEXT,
    gate TEXT,
    holding_point TEXT,
    sector_name TEXT,
    FOREIGN KEY(airport_code) REFERENCES LNG_AIRPORTS(airport_code)
);
"""


def create_table(conn: sqlite3.Connection) -> None:
    conn.execute(CREATE_SQL)


def reset_table_data(conn: sqlite3.Connection) -> None:
    conn.execute(f"DELETE FROM {TABLE_NAME};")


def create_item(conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
    return create_row(conn, TABLE_NAME, payload, WRITABLE_COLUMNS)


def get_item(conn: sqlite3.Connection, item_id: int) -> dict[str, Any] | None:
    return get_row(conn, TABLE_NAME, PK_COLUMN, item_id)


def list_items(conn: sqlite3.Connection, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    return list_rows(conn, TABLE_NAME, limit, offset)


def update_item(conn: sqlite3.Connection, item_id: int, payload: dict[str, Any]) -> bool:
    return update_row(conn, TABLE_NAME, PK_COLUMN, item_id, payload, WRITABLE_COLUMNS)


def delete_item(conn: sqlite3.Connection, item_id: int) -> bool:
    return delete_row(conn, TABLE_NAME, PK_COLUMN, item_id)
