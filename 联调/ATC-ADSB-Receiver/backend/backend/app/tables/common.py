from __future__ import annotations

import sqlite3
from typing import Any


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def create_row(
    conn: sqlite3.Connection,
    table: str,
    payload: dict[str, Any],
    writable_columns: set[str],
) -> int:
    data = {k: v for k, v in payload.items() if k in writable_columns}
    if not data:
        raise ValueError("No writable fields provided.")
    columns = ", ".join(data.keys())
    placeholders = ", ".join(["?"] * len(data))
    cursor = conn.execute(
        f"INSERT INTO {table} ({columns}) VALUES ({placeholders})",
        tuple(data.values()),
    )
    return int(cursor.lastrowid)


def get_row(
    conn: sqlite3.Connection,
    table: str,
    pk_column: str,
    pk_value: int | str,
) -> dict[str, Any] | None:
    row = conn.execute(
        f"SELECT * FROM {table} WHERE {pk_column} = ?",
        (pk_value,),
    ).fetchone()
    return _row_to_dict(row)


def list_rows(
    conn: sqlite3.Connection,
    table: str,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        f"SELECT * FROM {table} LIMIT ? OFFSET ?",
        (limit, offset),
    ).fetchall()
    return [dict(row) for row in rows]


def update_row(
    conn: sqlite3.Connection,
    table: str,
    pk_column: str,
    pk_value: int | str,
    payload: dict[str, Any],
    writable_columns: set[str],
) -> bool:
    data = {k: v for k, v in payload.items() if k in writable_columns}
    if not data:
        return False
    set_clause = ", ".join([f"{column} = ?" for column in data])
    params = list(data.values()) + [pk_value]
    cursor = conn.execute(
        f"UPDATE {table} SET {set_clause} WHERE {pk_column} = ?",
        tuple(params),
    )
    return cursor.rowcount > 0


def delete_row(
    conn: sqlite3.Connection,
    table: str,
    pk_column: str,
    pk_value: int | str,
) -> bool:
    cursor = conn.execute(
        f"DELETE FROM {table} WHERE {pk_column} = ?",
        (pk_value,),
    )
    return cursor.rowcount > 0
