from __future__ import annotations

import sqlite3
from typing import Any

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_USERS"
PK_COLUMN = "user_id"
WRITABLE_COLUMNS = {"username", "password_hash", "role", "email"}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT,
    email TEXT
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
