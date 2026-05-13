from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_ANNOTATIONS"
PK_COLUMN = "annotation_id"
WRITABLE_COLUMNS = {
    "label_type",
    "author_id",
    "audio_id",
    "relative_start",
    "relative_end",
    "abs_start_time",
    "abs_end_time",
    "asr_content",
    "vad_confidence",
    "is_annotated",
    "annotation_text",
    "annotation_time",
    "storage_tag",
    "next_id",
    "prev_id",
}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    annotation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    label_type TEXT,
    author_id INTEGER NOT NULL,
    audio_id INTEGER NOT NULL,
    relative_start REAL,
    relative_end REAL,
    abs_start_time TEXT,
    abs_end_time TEXT,
    asr_content TEXT,
    vad_confidence REAL,
    is_annotated INTEGER NOT NULL DEFAULT 0 CHECK(is_annotated IN (0,1)),
    annotation_text TEXT,
    annotation_time TEXT,
    storage_tag TEXT,
    next_id INTEGER,
    prev_id INTEGER,
    FOREIGN KEY(author_id) REFERENCES LNG_USERS(user_id),
    FOREIGN KEY(audio_id) REFERENCES LNG_AUDIO_RECORDS(audio_id),
    FOREIGN KEY(next_id) REFERENCES LNG_ANNOTATIONS(annotation_id),
    FOREIGN KEY(prev_id) REFERENCES LNG_ANNOTATIONS(annotation_id),
    CHECK(relative_start <= relative_end),
    CHECK(abs_end_time >= abs_start_time)
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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


CHAIN_PROTECTED_COLUMNS = frozenset({"next_id", "prev_id"})
EXT_CREATE_WRITABLE_COLUMNS = WRITABLE_COLUMNS - CHAIN_PROTECTED_COLUMNS


def _require_annotation(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    row = get_row(conn, TABLE_NAME, PK_COLUMN, item_id)
    if row is None:
        raise ValueError("Item not found.")
    return row


def _walk_prev_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["prev_id"] is not None:
        current_id = int(current["annotation_id"])
        if current_id in seen:
            raise ValueError("Circular annotation chain detected.")
        seen.add(current_id)
        prev_row = _require_annotation(conn, int(current["prev_id"]))
        chain.append(prev_row)
        current = prev_row
    chain.reverse()
    return chain


def _walk_next_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["next_id"] is not None:
        current_id = int(current["annotation_id"])
        if current_id in seen:
            raise ValueError("Circular annotation chain detected.")
        seen.add(current_id)
        next_row = _require_annotation(conn, int(current["next_id"]))
        chain.append(next_row)
        current = next_row
    return chain


def collect_chain_rows(conn: sqlite3.Connection, item_id: int) -> list[dict[str, Any]]:
    current = _require_annotation(conn, item_id)
    return _walk_prev_chain(conn, current) + [current] + _walk_next_chain(conn, current)


def collect_chain_ids(conn: sqlite3.Connection, item_id: int) -> list[int]:
    return [int(row["annotation_id"]) for row in collect_chain_rows(conn, item_id)]


def _find_chain_tail(conn: sqlite3.Connection, audio_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"""
        SELECT * FROM {TABLE_NAME}
        WHERE audio_id = ? AND next_id IS NULL
        ORDER BY annotation_id DESC
        LIMIT 1
        """,
        (audio_id,),
    ).fetchone()
    return dict(row) if row is not None else None


def _normalize_ext_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Payload must be an object.")
    if CHAIN_PROTECTED_COLUMNS.intersection(payload):
        raise ValueError("Do not provide prev_id or next_id; the server maintains the chain.")
    if "audio_id" not in payload:
        raise ValueError("Missing required field: audio_id")
    return dict(payload)


def _append_one_row(conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
    data = _normalize_ext_create_payload(payload)
    audio_id = int(data["audio_id"])
    row_data = {k: v for k, v in data.items() if k in EXT_CREATE_WRITABLE_COLUMNS}
    if not row_data:
        raise ValueError("No writable fields provided.")
    row_data["annotation_time"] = _now_iso()
    row_data["prev_id"] = None
    row_data["next_id"] = None
    tail = _find_chain_tail(conn, audio_id)
    if tail is None:
        return create_row(conn, TABLE_NAME, row_data, WRITABLE_COLUMNS)
    tail_id = int(tail["annotation_id"])
    row_data["prev_id"] = tail_id
    new_id = create_row(conn, TABLE_NAME, row_data, WRITABLE_COLUMNS)
    update_row(conn, TABLE_NAME, PK_COLUMN, tail_id, {"next_id": new_id}, WRITABLE_COLUMNS)
    return new_id


def _segment_create_result(ids: list[int]) -> dict[str, Any]:
    if len(ids) == 1:
        i = ids[0]
        return {"id": i, "annotation_id": i}
    return {"id": ids[0], "annotation_id": ids}


def create_items_chain_extended(
    conn: sqlite3.Connection,
    payload: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any] | list[dict[str, Any]]:
    if isinstance(payload, dict):
        new_id = _append_one_row(conn, payload)
        return _segment_create_result([new_id])
    if isinstance(payload, list):
        if not payload:
            raise ValueError("Payload array must not be empty.")
        out: list[dict[str, Any]] = []
        idx = 0
        while idx < len(payload):
            if not isinstance(payload[idx], dict):
                raise ValueError("Each list entry must be an object.")
            aid = int(payload[idx]["audio_id"])
            segment_ids: list[int] = []
            while idx < len(payload) and int(payload[idx]["audio_id"]) == aid:
                segment_ids.append(_append_one_row(conn, payload[idx]))
                idx += 1
            out.append(_segment_create_result(segment_ids))
        return out
    raise ValueError("Payload must be an object or an array of objects.")


def delete_chain_extended(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    from app.db.bootstrap import db_ui_delete_row

    chain_ids = collect_chain_ids(conn, int(item_id))
    for cid in chain_ids:
        db_ui_delete_row(conn, "annotations", cid)
    return {"deleted": True, "ids": chain_ids, "count": len(chain_ids)}


def delete_one_extended(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    from app.db.bootstrap import db_ui_delete_row

    row = get_row(conn, TABLE_NAME, PK_COLUMN, item_id)
    if row is None:
        raise ValueError("Item not found.")
    prev_raw = row["prev_id"]
    next_raw = row["next_id"]
    prev_val = int(prev_raw) if prev_raw is not None else None
    next_val = int(next_raw) if next_raw is not None else None
    relinked = False
    if prev_val is not None:
        conn.execute(
            f"UPDATE {TABLE_NAME} SET next_id = ? WHERE annotation_id = ?",
            (next_raw, prev_val),
        )
        relinked = True
    if next_val is not None:
        conn.execute(
            f"UPDATE {TABLE_NAME} SET prev_id = ? WHERE annotation_id = ?",
            (prev_raw, next_val),
        )
        relinked = True
    db_ui_delete_row(conn, "annotations", item_id)
    return {
        "deleted": True,
        "id": item_id,
        "prev_id": prev_val,
        "next_id": next_val,
        "relinked": relinked,
    }


def _order_chain_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        return rows
    by_id = {int(r["annotation_id"]): r for r in rows}
    heads = [r for r in rows if r.get("prev_id") is None]
    if len(heads) != 1:
        return sorted(rows, key=lambda x: int(x["annotation_id"]))
    head = heads[0]
    ordered: list[dict[str, Any]] = [head]
    cur = head
    while cur.get("next_id") is not None:
        nxt = by_id.get(int(cur["next_id"]))
        if nxt is None:
            break
        ordered.append(nxt)
        cur = nxt
    return ordered


def _distinct_chains_from_rows(
    conn: sqlite3.Connection,
    rows: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    seen: set[int] = set()
    chains: list[list[dict[str, Any]]] = []
    for r in rows:
        rid = int(r["annotation_id"])
        if rid in seen:
            continue
        chain_rows = collect_chain_rows(conn, rid)
        for x in chain_rows:
            seen.add(int(x["annotation_id"]))
        chains.append(_order_chain_rows(chain_rows))
    chains.sort(key=lambda c: int(c[0]["annotation_id"]))
    return chains


def search_chains_all(
    conn: sqlite3.Connection,
    filters: dict[str, Any],
    limit: int,
) -> list[Any]:
    from app.db.bootstrap import db_ui_search_rows

    search_result = db_ui_search_rows(conn, "annotations", filters, limit=limit)
    hit_rows = search_result["rows"]
    chains = _distinct_chains_from_rows(conn, hit_rows)
    if not chains:
        return []
    if len(chains) == 1:
        return chains[0]
    return chains


def search_chains_one(
    conn: sqlite3.Connection,
    filters: dict[str, Any],
    limit: int,
) -> list[dict[str, Any]]:
    from app.db.bootstrap import db_ui_search_rows

    search_result = db_ui_search_rows(conn, "annotations", filters, limit=limit)
    hit_rows = search_result["rows"]
    chains = _distinct_chains_from_rows(conn, hit_rows)
    if len(chains) > 1:
        raise ValueError("Multiple annotation chains matched; search-one requires at most one chain.")
    if not chains:
        return []
    return chains[0]


def update_item_chain_only(
    conn: sqlite3.Connection,
    item_id: int,
    payload: dict[str, Any],
) -> dict[str, Any]:
    if CHAIN_PROTECTED_COLUMNS.intersection(payload):
        raise ValueError("next_id and prev_id cannot be updated.")
    allowed = EXT_CREATE_WRITABLE_COLUMNS
    cleaned = {k: v for k, v in payload.items() if k in allowed}
    if not cleaned:
        raise ValueError("No writable fields provided.")
    if get_row(conn, TABLE_NAME, PK_COLUMN, item_id) is None:
        raise ValueError("Item not found.")
    cleaned["annotation_time"] = _now_iso()
    updated = update_row(conn, TABLE_NAME, PK_COLUMN, item_id, cleaned, WRITABLE_COLUMNS)
    if not updated:
        raise ValueError("Item not found or no fields changed")
    return {"updated": True, "id": item_id}
