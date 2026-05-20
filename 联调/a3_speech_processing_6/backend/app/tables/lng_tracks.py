from __future__ import annotations

import sqlite3
from typing import Any

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_TRACKS"
PK_COLUMN = "track_id"
WRITABLE_COLUMNS = {
    "timestamp",
    "flight_id",
    "tracks_latitude",
    "tracks_longitude",
    "altitude",
    "speed",
    "heading",
    "departure_airport_code",
    "arrival_airport_code",
    "next_id",
    "prev_id",
}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    track_id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    flight_id TEXT NOT NULL,
    tracks_latitude REAL NOT NULL,
    tracks_longitude REAL NOT NULL,
    altitude REAL,
    speed REAL,
    heading REAL,
    departure_airport_code TEXT,
    arrival_airport_code TEXT,
    next_id INTEGER,
    prev_id INTEGER,
    FOREIGN KEY(departure_airport_code) REFERENCES LNG_AIRPORTS(airport_code),
    FOREIGN KEY(arrival_airport_code) REFERENCES LNG_AIRPORTS(airport_code),
    FOREIGN KEY(next_id) REFERENCES LNG_TRACKS(track_id),
    FOREIGN KEY(prev_id) REFERENCES LNG_TRACKS(track_id)
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


BASE_REQUIRED_COLUMNS = {
    "timestamp",
    "flight_id",
    "tracks_latitude",
    "tracks_longitude",
    "altitude",
    "speed",
    "heading",
}
CHAIN_PROTECTED_COLUMNS = {"next_id", "prev_id"}
AIRPORT_EDGE_COLUMNS = {"departure_airport_code", "arrival_airport_code"}
CHAIN_SHARED_COLUMNS = BASE_REQUIRED_COLUMNS | {
    "departure_airport_code",
    "arrival_airport_code",
}


def _normalize_track_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Track payload must be an object.")
    data = dict(payload)
    airport_code = data.pop("airport_code", None)
    if not isinstance(airport_code, list):
        raise ValueError("airport_code must be an array.")
    if len(airport_code) < 2:
        raise ValueError("airport_code must contain at least 2 airport codes.")
    normalized_airports = []
    for code in airport_code:
        if not isinstance(code, str) or not code.strip():
            raise ValueError("airport_code entries must be non-empty strings.")
        normalized_airports.append(code.strip())
    missing = [column for column in BASE_REQUIRED_COLUMNS if column not in data]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(sorted(missing))}")
    forbidden = CHAIN_PROTECTED_COLUMNS | AIRPORT_EDGE_COLUMNS
    unexpected = forbidden.intersection(data)
    if unexpected:
        raise ValueError(
            f"Do not provide derived chain fields: {', '.join(sorted(unexpected))}"
        )
    return {**data, "airport_code": normalized_airports}


def _build_segment_payloads(payload: dict[str, Any]) -> list[dict[str, Any]]:
    normalized = _normalize_track_payload(payload)
    airport_code = normalized.pop("airport_code")
    segment_payloads: list[dict[str, Any]] = []
    for idx in range(len(airport_code) - 1):
        segment_payload = dict(normalized)
        segment_payload["departure_airport_code"] = airport_code[idx]
        segment_payload["arrival_airport_code"] = airport_code[idx + 1]
        segment_payload["prev_id"] = None
        segment_payload["next_id"] = None
        segment_payloads.append(segment_payload)
    return segment_payloads


def create_item_extended(
    conn: sqlite3.Connection,
    payload: dict[str, Any],
) -> dict[str, Any]:
    segment_payloads = _build_segment_payloads(payload)
    created_ids: list[int] = []
    previous_id: int | None = None
    for segment_payload in segment_payloads:
        segment_payload["prev_id"] = previous_id
        item_id = create_item(conn, segment_payload)
        created_ids.append(item_id)
        if previous_id is not None:
            update_item(conn, previous_id, {"next_id": item_id})
        previous_id = item_id
    if len(created_ids) == 1:
        return {"id": created_ids[0], "track_id": created_ids[0]}
    return {"id": created_ids[0], "track_id": created_ids}


def create_items_extended(
    conn: sqlite3.Connection,
    payload: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any] | list[dict[str, Any]]:
    if isinstance(payload, list):
        return [create_item_extended(conn, item) for item in payload]
    if isinstance(payload, dict):
        return create_item_extended(conn, payload)
    raise ValueError("Payload must be an object or an array of objects.")


def _require_track(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    row = get_item(conn, item_id)
    if row is None:
        raise ValueError("Item not found.")
    return row


def _walk_prev_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["prev_id"] is not None:
        current_id = int(current["track_id"])
        if current_id in seen:
            raise ValueError("Circular track chain detected.")
        seen.add(current_id)
        prev_row = _require_track(conn, int(current["prev_id"]))
        chain.append(prev_row)
        current = prev_row
    chain.reverse()
    return chain


def _walk_next_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["next_id"] is not None:
        current_id = int(current["track_id"])
        if current_id in seen:
            raise ValueError("Circular track chain detected.")
        seen.add(current_id)
        next_row = _require_track(conn, int(current["next_id"]))
        chain.append(next_row)
        current = next_row
    return chain


def collect_chain_rows(conn: sqlite3.Connection, item_id: int) -> list[dict[str, Any]]:
    current = _require_track(conn, item_id)
    return _walk_prev_chain(conn, current) + [current] + _walk_next_chain(conn, current)


def collect_chain_ids(conn: sqlite3.Connection, item_id: int) -> list[int]:
    return [int(row["track_id"]) for row in collect_chain_rows(conn, item_id)]


def update_item_extended(
    conn: sqlite3.Connection,
    item_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("values must be an object")
    if CHAIN_PROTECTED_COLUMNS.intersection(payload):
        raise ValueError("next_id and prev_id cannot be updated.")
    chain_rows = collect_chain_rows(conn, item_id)
    allowed_columns = WRITABLE_COLUMNS - CHAIN_PROTECTED_COLUMNS
    cleaned = {k: v for k, v in payload.items() if k in allowed_columns}
    if not cleaned:
        raise ValueError("No writable fields provided.")

    shared_payload = {
        k: v for k, v in cleaned.items() if k not in AIRPORT_EDGE_COLUMNS
    }
    for row in chain_rows:
        if shared_payload:
            update_item(conn, int(row["track_id"]), shared_payload)

    current_row = _require_track(conn, item_id)
    if "departure_airport_code" in cleaned:
        departure_code = cleaned["departure_airport_code"]
        update_item(conn, item_id, {"departure_airport_code": departure_code})
        if current_row["prev_id"] is not None:
            update_item(
                conn,
                int(current_row["prev_id"]),
                {"arrival_airport_code": departure_code},
            )

    if "arrival_airport_code" in cleaned:
        arrival_code = cleaned["arrival_airport_code"]
        update_item(conn, item_id, {"arrival_airport_code": arrival_code})
        if current_row["next_id"] is not None:
            update_item(
                conn,
                int(current_row["next_id"]),
                {"departure_airport_code": arrival_code},
            )

    return {"updated": True, "id": item_id, "chain_ids": collect_chain_ids(conn, item_id)}


def build_aggregated_search_result(
    conn: sqlite3.Connection,
    rows: list[dict[str, Any]],
) -> dict[str, Any] | list[dict[str, Any]]:
    if not rows:
        return []
    grouped: list[dict[str, Any]] = []
    seen: set[int] = set()
    for row in rows:
        track_id = int(row["track_id"])
        if track_id in seen:
            continue
        chain_rows = collect_chain_rows(conn, track_id)
        for chain_row in chain_rows:
            seen.add(int(chain_row["track_id"]))
        first_row = chain_rows[0]
        airport_codes = [first_row["departure_airport_code"]]
        airport_codes.extend(chain_row["arrival_airport_code"] for chain_row in chain_rows)
        grouped.append(
            {
                "track_id": [int(chain_row["track_id"]) for chain_row in chain_rows],
                "airport_code": airport_codes,
                "timestamp": first_row["timestamp"],
                "flight_id": first_row["flight_id"],
                "tracks_latitude": first_row["tracks_latitude"],
                "tracks_longitude": first_row["tracks_longitude"],
                "altitude": first_row["altitude"],
                "speed": first_row["speed"],
                "heading": first_row["heading"],
            }
        )
    if len(grouped) == 1:
        return grouped[0]
    return grouped
