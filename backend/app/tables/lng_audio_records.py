from __future__ import annotations

import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

UTC = timezone.utc

from app.tables.common import create_row, delete_row, get_row, list_rows, update_row

TABLE_NAME = "LNG_AUDIO_RECORDS"
PK_COLUMN = "audio_id"
WRITABLE_COLUMNS = {
    "source_url",
    "start_time_utc",
    "end_time_utc",
    "duration_ms",
    "file_name",
    "file_path",
    "file_size",
    "status",
    "last_access_at",
    "track_id",
    "next_id",
    "prev_id",
}

CREATE_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
    audio_id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_url TEXT NOT NULL,
    start_time_utc TEXT NOT NULL,
    end_time_utc TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    status INTEGER NOT NULL DEFAULT 0 CHECK(status IN (0,1,2,3)),
    last_access_at TEXT,
    track_id INTEGER NOT NULL,
    next_id INTEGER,
    prev_id INTEGER,
    FOREIGN KEY(track_id) REFERENCES LNG_TRACKS(track_id),
    FOREIGN KEY(next_id) REFERENCES LNG_AUDIO_RECORDS(audio_id),
    FOREIGN KEY(prev_id) REFERENCES LNG_AUDIO_RECORDS(audio_id),
    CHECK(end_time_utc >= start_time_utc)
);
"""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _touch_last_access_at(conn: sqlite3.Connection, audio_ids: list[int], now_iso: str) -> None:
    if not audio_ids:
        return
    conn.execute(
        f"UPDATE {TABLE_NAME} SET last_access_at = ? WHERE audio_id IN ({','.join(['?'] * len(audio_ids))})",
        (now_iso, *audio_ids),
    )


def create_table(conn: sqlite3.Connection) -> None:
    conn.execute(CREATE_SQL)


def reset_table_data(conn: sqlite3.Connection) -> None:
    conn.execute(f"DELETE FROM {TABLE_NAME};")


def create_item(conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
    data = dict(payload)
    data["last_access_at"] = _now_iso()
    return create_row(conn, TABLE_NAME, data, WRITABLE_COLUMNS)


def get_item(conn: sqlite3.Connection, item_id: int) -> dict[str, Any] | None:
    row = get_row(conn, TABLE_NAME, PK_COLUMN, item_id)
    if row is None:
        return None
    now = _now_iso()
    _touch_last_access_at(conn, [int(row["audio_id"])], now)
    row["last_access_at"] = now
    return row


def list_items(conn: sqlite3.Connection, limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    rows = list_rows(conn, TABLE_NAME, limit, offset)
    if not rows:
        return rows
    now = _now_iso()
    audio_ids = [int(r["audio_id"]) for r in rows if r.get("audio_id") is not None]
    _touch_last_access_at(conn, audio_ids, now)
    for r in rows:
        r["last_access_at"] = now
    return rows


def update_item(conn: sqlite3.Connection, item_id: int, payload: dict[str, Any]) -> bool:
    data = dict(payload)
    data["last_access_at"] = _now_iso()
    return update_row(conn, TABLE_NAME, PK_COLUMN, item_id, data, WRITABLE_COLUMNS)


def delete_item(conn: sqlite3.Connection, item_id: int) -> bool:
    return delete_row(conn, TABLE_NAME, PK_COLUMN, item_id)


CHAIN_PROTECTED_COLUMNS = frozenset({"next_id", "prev_id"})
EXT_CREATE_WRITABLE_COLUMNS = WRITABLE_COLUMNS - CHAIN_PROTECTED_COLUMNS


def _require_audio(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    row = get_row(conn, TABLE_NAME, PK_COLUMN, item_id)
    if row is None:
        raise ValueError("Item not found.")
    return row


def _walk_prev_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["prev_id"] is not None:
        current_id = int(current["audio_id"])
        if current_id in seen:
            raise ValueError("Circular audio chain detected.")
        seen.add(current_id)
        prev_row = _require_audio(conn, int(current["prev_id"]))
        chain.append(prev_row)
        current = prev_row
    chain.reverse()
    return chain


def _walk_next_chain(conn: sqlite3.Connection, row: dict[str, Any]) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    current = row
    seen: set[int] = set()
    while current["next_id"] is not None:
        current_id = int(current["audio_id"])
        if current_id in seen:
            raise ValueError("Circular audio chain detected.")
        seen.add(current_id)
        next_row = _require_audio(conn, int(current["next_id"]))
        chain.append(next_row)
        current = next_row
    return chain


def collect_chain_rows(conn: sqlite3.Connection, item_id: int) -> list[dict[str, Any]]:
    current = _require_audio(conn, item_id)
    return _walk_prev_chain(conn, current) + [current] + _walk_next_chain(conn, current)


def collect_chain_ids(conn: sqlite3.Connection, item_id: int) -> list[int]:
    return [int(row["audio_id"]) for row in collect_chain_rows(conn, item_id)]


def _find_chain_tail(conn: sqlite3.Connection, track_id: int) -> dict[str, Any] | None:
    row = conn.execute(
        f"""
        SELECT * FROM {TABLE_NAME}
        WHERE track_id = ? AND next_id IS NULL
        ORDER BY audio_id DESC
        LIMIT 1
        """,
        (track_id,),
    ).fetchone()
    return dict(row) if row is not None else None


def _normalize_ext_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("Payload must be an object.")
    if CHAIN_PROTECTED_COLUMNS.intersection(payload):
        raise ValueError("Do not provide prev_id or next_id; the server maintains the chain.")
    if "track_id" not in payload:
        raise ValueError("Missing required field: track_id")
    return dict(payload)


def _append_one_row(conn: sqlite3.Connection, payload: dict[str, Any]) -> int:
    data = _normalize_ext_create_payload(payload)
    track_id = int(data["track_id"])
    row_data = {k: v for k, v in data.items() if k in EXT_CREATE_WRITABLE_COLUMNS}
    if not row_data:
        raise ValueError("No writable fields provided.")
    row_data["last_access_at"] = _now_iso()
    row_data["prev_id"] = None
    row_data["next_id"] = None
    tail = _find_chain_tail(conn, track_id)
    if tail is None:
        new_id = create_row(conn, TABLE_NAME, row_data, WRITABLE_COLUMNS)
        return new_id
    tail_id = int(tail["audio_id"])
    row_data["prev_id"] = tail_id
    new_id = create_row(conn, TABLE_NAME, row_data, WRITABLE_COLUMNS)
    update_row(conn, TABLE_NAME, PK_COLUMN, tail_id, {"next_id": new_id}, WRITABLE_COLUMNS)
    return new_id


def _segment_create_result(ids: list[int]) -> dict[str, Any]:
    if len(ids) == 1:
        i = ids[0]
        return {"id": i, "audio_id": i}
    return {"id": ids[0], "audio_id": ids}


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
            tid = int(payload[idx]["track_id"])
            segment_ids: list[int] = []
            while idx < len(payload) and int(payload[idx]["track_id"]) == tid:
                segment_ids.append(_append_one_row(conn, payload[idx]))
                idx += 1
            out.append(_segment_create_result(segment_ids))
        return out
    raise ValueError("Payload must be an object or an array of objects.")


def delete_chain_extended(conn: sqlite3.Connection, item_id: int) -> dict[str, Any]:
    from app.db.bootstrap import db_ui_delete_row

    chain_ids = collect_chain_ids(conn, int(item_id))
    for cid in chain_ids:
        db_ui_delete_row(conn, "audio_records", cid)
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
            f"UPDATE {TABLE_NAME} SET next_id = ? WHERE audio_id = ?",
            (next_raw, prev_val),
        )
        relinked = True
    if next_val is not None:
        conn.execute(
            f"UPDATE {TABLE_NAME} SET prev_id = ? WHERE audio_id = ?",
            (prev_raw, next_val),
        )
        relinked = True
    db_ui_delete_row(conn, "audio_records", item_id)
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
    by_id = {int(r["audio_id"]): r for r in rows}
    heads = [r for r in rows if r.get("prev_id") is None]
    if len(heads) != 1:
        return sorted(rows, key=lambda x: int(x["audio_id"]))
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
        aid = int(r["audio_id"])
        if aid in seen:
            continue
        chain_rows = collect_chain_rows(conn, aid)
        for x in chain_rows:
            seen.add(int(x["audio_id"]))
        chains.append(_order_chain_rows(chain_rows))
    chains.sort(key=lambda c: int(c[0]["audio_id"]))
    return chains


def search_chains_all(
    conn: sqlite3.Connection,
    filters: dict[str, Any],
    limit: int,
) -> list[Any]:
    from app.db.bootstrap import db_ui_search_rows

    search_result = db_ui_search_rows(conn, "audio_records", filters, limit=limit)
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

    search_result = db_ui_search_rows(conn, "audio_records", filters, limit=limit)
    hit_rows = search_result["rows"]
    chains = _distinct_chains_from_rows(conn, hit_rows)
    if len(chains) > 1:
        raise ValueError("Multiple audio chains matched; search-one requires at most one chain.")
    if not chains:
        return []
    return chains[0]


def _parse_utc_text(value: str | None) -> datetime | None:
    if not value or not str(value).strip():
        return None
    s = str(value).strip()
    if re.match(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}", s) and not re.search(
        r"[zZ]$|[+-]\d{2}:?\d{2}$", s
    ):
        s = s.replace(" ", "T") + ("Z" if "T" in s else "Z")
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def list_by_utc_range(
    conn: sqlite3.Connection,
    start_utc: str,
    end_utc: str,
    *,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """返回与 [start_utc, end_utc) 有交集的录音，按 start_time_utc 升序。"""
    start = _parse_utc_text(start_utc)
    end = _parse_utc_text(end_utc)
    if start is None or end is None:
        raise ValueError("start_utc / end_utc 格式无效，请使用 ISO8601 UTC")
    if end <= start:
        raise ValueError("end_utc 必须晚于 start_utc")

    rows = conn.execute(
        f"SELECT * FROM {TABLE_NAME} ORDER BY start_time_utc ASC"
    ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        r = dict(row)
        rs = _parse_utc_text(str(r.get("start_time_utc") or ""))
        re_ = _parse_utc_text(str(r.get("end_time_utc") or ""))
        if rs is None:
            continue
        if re_ is None:
            dur_ms = int(r.get("duration_ms") or 0) or 60_000
            re_ = rs + timedelta(milliseconds=dur_ms)
        if rs < end and re_ > start:
            out.append(r)
        if len(out) >= limit:
            break
    return out


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
    updated = update_item(conn, item_id, cleaned)
    if not updated:
        raise ValueError("Item not found or no fields changed")
    return {"updated": True, "id": item_id}
