from __future__ import annotations

import sqlite3
from collections import deque
from datetime import datetime, timezone
from typing import Any

from app.tables.registry import CREATION_ORDER, TABLE_MODULES

DEPENDENCY_GRAPH = {
    "airports": {"tracks", "vsp_data"},
    "users": {"annotations"},
    "tracks": {"audio_records"},
    "audio_records": {"annotations"},
    "annotations": set(),
    "vsp_data": set(),
    "storage_log": set(),
}


def _existing_tables(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    return {row["name"] for row in rows}


def initialize_database(conn: sqlite3.Connection) -> None:
    existing = _existing_tables(conn)
    for table_key in CREATION_ORDER:
        module = TABLE_MODULES[table_key]
        if module.TABLE_NAME not in existing:
            module.create_table(conn)
    _migrate_schema(conn)


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(r["name"]) for r in rows}


def _migrate_schema(conn: sqlite3.Connection) -> None:
    _migrate_storage_log_target_file_id_to_source_url(conn)
    _migrate_latlon_columns(conn)


def _migrate_storage_log_target_file_id_to_source_url(conn: sqlite3.Connection) -> None:
    if "LNG_STORAGE_LOG" not in _existing_tables(conn):
        return
    cols = _table_columns(conn, "LNG_STORAGE_LOG")
    if "target_file_id" not in cols:
        return

    # Old schema:
    #   (id, action_type, target_file_id, released_space, op_time)
    # New schema:
    #   (id, action_type, source_url, released_space, op_time)
    conn.execute("PRAGMA foreign_keys = OFF;")
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS LNG_STORAGE_LOG__new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type TEXT NOT NULL CHECK(action_type IN ('CLEANUP', 'ARCHIVE')),
                source_url TEXT NOT NULL,
                released_space INTEGER NOT NULL,
                op_time TEXT NOT NULL
            );
            """
        )

        rows = conn.execute(
            "SELECT id, action_type, target_file_id, released_space, op_time FROM LNG_STORAGE_LOG"
        ).fetchall()
        for r in rows:
            audio_id = r["target_file_id"]
            source = conn.execute(
                "SELECT source_url FROM LNG_AUDIO_RECORDS WHERE audio_id = ?",
                (audio_id,),
            ).fetchone()
            if source is not None and source["source_url"] not in (None, ""):
                source_url = str(source["source_url"])
            else:
                source_url = f"deleted_audio_id:{audio_id}"
            conn.execute(
                """
                INSERT INTO LNG_STORAGE_LOG__new(id, action_type, source_url, released_space, op_time)
                VALUES (?, ?, ?, ?, ?)
                """,
                (r["id"], r["action_type"], source_url, r["released_space"], r["op_time"]),
            )

        conn.execute("DROP TABLE LNG_STORAGE_LOG;")
        conn.execute("ALTER TABLE LNG_STORAGE_LOG__new RENAME TO LNG_STORAGE_LOG;")
    finally:
        conn.execute("PRAGMA foreign_keys = ON;")


def _migrate_latlon_columns(conn: sqlite3.Connection) -> None:
    existing = _existing_tables(conn)

    if "LNG_AIRPORTS" in existing:
        cols = _table_columns(conn, "LNG_AIRPORTS")
        if "latitude" in cols or "longitude" in cols:
            conn.execute("PRAGMA foreign_keys = OFF;")
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS LNG_AIRPORTS__new (
                        airport_code TEXT PRIMARY KEY,
                        name TEXT,
                        country_code TEXT,
                        airports_latitude REAL,
                        airports_longitude REAL
                    );
                    """
                )
                conn.execute(
                    """
                    INSERT INTO LNG_AIRPORTS__new(airport_code, name, country_code, airports_latitude, airports_longitude)
                    SELECT airport_code, name, country_code, latitude, longitude FROM LNG_AIRPORTS
                    """
                )
                conn.execute("DROP TABLE LNG_AIRPORTS;")
                conn.execute("ALTER TABLE LNG_AIRPORTS__new RENAME TO LNG_AIRPORTS;")
            finally:
                conn.execute("PRAGMA foreign_keys = ON;")

    if "LNG_TRACKS" in existing:
        cols = _table_columns(conn, "LNG_TRACKS")
        if "latitude" in cols or "longitude" in cols:
            conn.execute("PRAGMA foreign_keys = OFF;")
            try:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS LNG_TRACKS__new (
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
                )
                conn.execute(
                    """
                    INSERT INTO LNG_TRACKS__new(
                        track_id, timestamp, flight_id, tracks_latitude, tracks_longitude,
                        altitude, speed, heading, departure_airport_code, arrival_airport_code, next_id, prev_id
                    )
                    SELECT
                        track_id, timestamp, flight_id, latitude, longitude,
                        altitude, speed, heading, departure_airport_code, arrival_airport_code, next_id, prev_id
                    FROM LNG_TRACKS
                    """
                )
                conn.execute("DROP TABLE LNG_TRACKS;")
                conn.execute("ALTER TABLE LNG_TRACKS__new RENAME TO LNG_TRACKS;")
            finally:
                conn.execute("PRAGMA foreign_keys = ON;")
        cols = _table_columns(conn, "LNG_TRACKS")
        if "vertical_rate" not in cols:
            conn.execute("ALTER TABLE LNG_TRACKS ADD COLUMN vertical_rate REAL")


def _descendants(table_key: str) -> set[str]:
    seen: set[str] = set()
    queue: deque[str] = deque([table_key])
    while queue:
        current = queue.popleft()
        for child in DEPENDENCY_GRAPH[current]:
            if child not in seen:
                seen.add(child)
                queue.append(child)
    return seen


def _child_to_parents() -> dict[str, set[str]]:
    parents: dict[str, set[str]] = {k: set() for k in TABLE_MODULES}
    for parent, children in DEPENDENCY_GRAPH.items():
        for child in children:
            parents[child].add(parent)
    return parents


def _ancestors(table_key: str) -> set[str]:
    if table_key not in TABLE_MODULES:
        raise KeyError(f"Unknown table key: {table_key}")
    child_to_parents = _child_to_parents()
    seen: set[str] = set()
    queue: deque[str] = deque(child_to_parents[table_key])
    while queue:
        current = queue.popleft()
        if current in seen:
            continue
        seen.add(current)
        for parent in child_to_parents[current]:
            if parent not in seen:
                queue.append(parent)
    return seen


def drop_tables_cascade(conn: sqlite3.Connection, table_key: str) -> list[str]:
    if table_key not in TABLE_MODULES:
        raise KeyError(f"Unknown table key: {table_key}")
    impacted = _descendants(table_key)
    impacted.add(table_key)
    drop_order = [key for key in reversed(CREATION_ORDER) if key in impacted]
    conn.execute("PRAGMA foreign_keys = OFF;")
    try:
        for key in drop_order:
            name = TABLE_MODULES[key].TABLE_NAME
            conn.execute(f"DROP TABLE IF EXISTS {name};")
    finally:
        conn.execute("PRAGMA foreign_keys = ON;")
    return drop_order


def ensure_tables_with_ancestors(
    conn: sqlite3.Connection, table_key: str
) -> list[dict[str, str]]:
    if table_key not in TABLE_MODULES:
        raise KeyError(f"Unknown table key: {table_key}")
    needed = _ancestors(table_key) | {table_key}
    ordered = [k for k in CREATION_ORDER if k in needed]
    existing_names = set(_existing_tables(conn))
    actions: list[dict[str, str]] = []
    for key in ordered:
        module = TABLE_MODULES[key]
        name = module.TABLE_NAME
        if name not in existing_names:
            module.create_table(conn)
            existing_names.add(name)
            actions.append({"key": key, "action": "created"})
        else:
            actions.append({"key": key, "action": "skipped"})
    return actions


def build_db_ui_snapshot(
    conn: sqlite3.Connection, row_limit: int = 100
) -> list[dict[str, Any]]:
    existing = _existing_tables(conn)
    out: list[dict[str, Any]] = []
    for table_key in CREATION_ORDER:
        module = TABLE_MODULES[table_key]
        sql_name = module.TABLE_NAME
        if sql_name not in existing:
            out.append(
                {
                    "key": table_key,
                    "sql_name": sql_name,
                    "exists": False,
                }
            )
            continue
        col_rows = conn.execute(f"PRAGMA table_info({sql_name})").fetchall()
        columns = [str(r["name"]) for r in col_rows]
        data_rows = conn.execute(
            f"SELECT * FROM {sql_name} LIMIT ?",
            (row_limit,),
        ).fetchall()
        out.append(
            {
                "key": table_key,
                "sql_name": sql_name,
                "exists": True,
                "columns": columns,
                "rows": [dict(r) for r in data_rows],
            }
        )
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _table_meta(conn: sqlite3.Connection, table_key: str) -> dict[str, Any]:
    if table_key not in TABLE_MODULES:
        raise KeyError(f"Unknown table key: {table_key}")
    module = TABLE_MODULES[table_key]
    table_name = module.TABLE_NAME
    if table_name not in _existing_tables(conn):
        raise ValueError(f"Table not created: {table_name}")
    info = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    columns = [str(x["name"]) for x in info]
    pk_col = next((str(x["name"]) for x in info if int(x["pk"]) == 1), module.PK_COLUMN)
    return {
        "module": module,
        "table_name": table_name,
        "columns": columns,
        "pk": pk_col,
    }


def _coerce_pk_value(module: Any, raw: Any) -> int | str:
    if raw is None:
        raise ValueError("Missing primary key value.")
    if module.PK_COLUMN.endswith("_id"):
        return int(raw)
    return str(raw)


def db_ui_create_row(conn: sqlite3.Connection, table_key: str, values: dict[str, Any]) -> dict[str, Any]:
    meta = _table_meta(conn, table_key)
    module = meta["module"]
    payload = dict(values)
    if table_key != "airports":
        payload.pop(module.PK_COLUMN, None)
    if table_key == "audio_records":
        payload["last_access_at"] = _now_iso()
    if table_key == "annotations":
        payload["annotation_time"] = _now_iso()
    item_id = module.create_item(conn, payload)
    return {"id": item_id}


def _detach_self_refs(conn: sqlite3.Connection, table_key: str, item_id: int | str) -> None:
    if table_key in {"tracks", "audio_records", "annotations"}:
        table_name = TABLE_MODULES[table_key].TABLE_NAME
        conn.execute(
            f"UPDATE {table_name} SET next_id = NULL WHERE next_id = ?",
            (item_id,),
        )
        conn.execute(
            f"UPDATE {table_name} SET prev_id = NULL WHERE prev_id = ?",
            (item_id,),
        )


def _log_audio_delete(conn: sqlite3.Connection, *, source_url: str, released_space: int) -> None:
    conn.execute(
        """
        INSERT INTO LNG_STORAGE_LOG(action_type, source_url, released_space, op_time)
        VALUES (?, ?, ?, ?)
        """,
        ("CLEANUP", source_url, released_space, _now_iso()),
    )


def _delete_row_cascade(conn: sqlite3.Connection, table_key: str, item_id: int | str) -> bool:
    module = TABLE_MODULES[table_key]
    if module.get_item(conn, item_id) is None:
        return False

    if table_key == "airports":
        track_rows = conn.execute(
            """
            SELECT track_id FROM LNG_TRACKS
            WHERE departure_airport_code = ? OR arrival_airport_code = ?
            """,
            (item_id, item_id),
        ).fetchall()
        for row in track_rows:
            _delete_row_cascade(conn, "tracks", int(row["track_id"]))
        conn.execute("DELETE FROM LNG_VSP_DATA WHERE airport_code = ?", (item_id,))
    elif table_key == "users":
        ann_rows = conn.execute(
            "SELECT annotation_id FROM LNG_ANNOTATIONS WHERE author_id = ?",
            (item_id,),
        ).fetchall()
        for row in ann_rows:
            _delete_row_cascade(conn, "annotations", int(row["annotation_id"]))
    elif table_key == "tracks":
        audio_rows = conn.execute(
            "SELECT audio_id FROM LNG_AUDIO_RECORDS WHERE track_id = ?",
            (item_id,),
        ).fetchall()
        for row in audio_rows:
            _delete_row_cascade(conn, "audio_records", int(row["audio_id"]))
    elif table_key == "audio_records":
        ann_rows = conn.execute(
            "SELECT annotation_id FROM LNG_ANNOTATIONS WHERE audio_id = ?",
            (item_id,),
        ).fetchall()
        for row in ann_rows:
            _delete_row_cascade(conn, "annotations", int(row["annotation_id"]))
        audio_row = module.get_item(conn, int(item_id))
        if audio_row is not None:
            file_size = audio_row.get("file_size")
            released_space = int(file_size) if file_size not in (None, "") else 0
            _log_audio_delete(
                conn,
                source_url=str(audio_row["source_url"]),
                released_space=released_space,
            )

    _detach_self_refs(conn, table_key, item_id)
    return module.delete_item(conn, item_id)


def db_ui_delete_row(conn: sqlite3.Connection, table_key: str, pk_value: Any) -> dict[str, Any]:
    meta = _table_meta(conn, table_key)
    module = meta["module"]
    item_id = _coerce_pk_value(module, pk_value)
    deleted = _delete_row_cascade(conn, table_key, item_id)
    if not deleted:
        raise ValueError("Item not found.")
    return {"deleted": True, "id": item_id}


def _search_rows(
    conn: sqlite3.Connection,
    table_name: str,
    filters: dict[str, Any],
    limit: int,
) -> list[dict[str, Any]]:
    if not filters:
        rows = conn.execute(
            f"SELECT * FROM {table_name} LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    where = " AND ".join([f"{k} = ?" for k in filters])
    rows = conn.execute(
        f"SELECT * FROM {table_name} WHERE {where} LIMIT ?",
        tuple(filters.values()) + (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def db_ui_search_rows(
    conn: sqlite3.Connection,
    table_key: str,
    filters: dict[str, Any],
    limit: int = 100,
) -> dict[str, Any]:
    meta = _table_meta(conn, table_key)
    module = meta["module"]
    allowed = set(meta["columns"])
    cleaned = {
        k: v
        for k, v in filters.items()
        if k in allowed and k != module.PK_COLUMN and v not in (None, "")
    }
    rows = _search_rows(conn, meta["table_name"], cleaned, limit)
    if table_key == "audio_records" and rows:
        now = _now_iso()
        conn.execute(
            f"UPDATE {meta['table_name']} SET last_access_at = ? WHERE audio_id IN ({','.join(['?'] * len(rows))})",
            (now, *[int(r["audio_id"]) for r in rows]),
        )
        rows = _search_rows(conn, meta["table_name"], cleaned, limit)
    return {"rows": rows}


def _update_airport_key(
    conn: sqlite3.Connection,
    old_id: str,
    new_id: str,
) -> None:
    exists = conn.execute(
        "SELECT airport_code FROM LNG_AIRPORTS WHERE airport_code = ?",
        (new_id,),
    ).fetchone()
    if exists is not None:
        raise ValueError("New airport_code already exists.")
    conn.execute("PRAGMA foreign_keys = OFF;")
    try:
        conn.execute(
            "UPDATE LNG_AIRPORTS SET airport_code = ? WHERE airport_code = ?",
            (new_id, old_id),
        )
        conn.execute(
            "UPDATE LNG_TRACKS SET departure_airport_code = ? WHERE departure_airport_code = ?",
            (new_id, old_id),
        )
        conn.execute(
            "UPDATE LNG_TRACKS SET arrival_airport_code = ? WHERE arrival_airport_code = ?",
            (new_id, old_id),
        )
        conn.execute(
            "UPDATE LNG_VSP_DATA SET airport_code = ? WHERE airport_code = ?",
            (new_id, old_id),
        )
    finally:
        conn.execute("PRAGMA foreign_keys = ON;")


def db_ui_update_row(
    conn: sqlite3.Connection,
    table_key: str,
    pk_value: Any,
    values: dict[str, Any],
    new_pk_value: Any = None,
) -> dict[str, Any]:
    meta = _table_meta(conn, table_key)
    module = meta["module"]
    item_id = _coerce_pk_value(module, pk_value)
    if module.get_item(conn, item_id) is None:
        raise ValueError("Item not found.")
    payload = {
        k: v
        for k, v in values.items()
        if k in set(meta["columns"]) and k != module.PK_COLUMN
    }
    if table_key == "airports" and new_pk_value not in (None, ""):
        new_id = str(new_pk_value)
        if new_id != str(item_id):
            _update_airport_key(conn, str(item_id), new_id)
            item_id = new_id
    elif table_key != "airports":
        payload.pop(module.PK_COLUMN, None)

    if table_key == "audio_records":
        payload["last_access_at"] = _now_iso()
    if table_key == "annotations":
        payload["annotation_time"] = _now_iso()

    if payload:
        updated = module.update_item(conn, item_id, payload)
    else:
        updated = True
    if not updated:
        raise ValueError("Item not found or no fields changed")
    return {"updated": True, "id": item_id}


def reset_table_cascade(conn: sqlite3.Connection, table_key: str) -> list[str]:
    if table_key not in TABLE_MODULES:
        raise KeyError(f"Unknown table key: {table_key}")
    impacted = _descendants(table_key)
    impacted.add(table_key)

    clear_order = [key for key in reversed(CREATION_ORDER) if key in impacted]
    create_order = [key for key in CREATION_ORDER if key in impacted]

    for key in clear_order:
        TABLE_MODULES[key].reset_table_data(conn)
    for key in create_order:
        TABLE_MODULES[key].create_table(conn)

    return create_order


def reset_all_tables(conn: sqlite3.Connection) -> list[str]:
    for key in reversed(CREATION_ORDER):
        TABLE_MODULES[key].reset_table_data(conn)
    for key in CREATION_ORDER:
        TABLE_MODULES[key].create_table(conn)
    return list(CREATION_ORDER)


def _build_fk_edges(conn: sqlite3.Connection) -> tuple[dict[str, str], list[dict[str, str]], dict[str, set[str]]]:
    key_to_sql = {k: TABLE_MODULES[k].TABLE_NAME for k in TABLE_MODULES}
    sql_to_key = {v: k for k, v in key_to_sql.items()}
    edges: list[dict[str, str]] = []
    graph: dict[str, set[str]] = {k: set() for k in TABLE_MODULES}
    for child_key, sql_name in key_to_sql.items():
        rows = conn.execute(f"PRAGMA foreign_key_list({sql_name})").fetchall()
        for r in rows:
            parent_sql = str(r["table"])
            parent_key = sql_to_key.get(parent_sql)
            if parent_key is None:
                continue
            edge = {
                "child": child_key,
                "parent": parent_key,
                "from_col": str(r["from"]),
                "to_col": str(r["to"]),
            }
            edges.append(edge)
            graph[child_key].add(parent_key)
            graph[parent_key].add(child_key)
    return key_to_sql, edges, graph


def _build_field_owner_map(conn: sqlite3.Connection) -> dict[str, set[str]]:
    owners: dict[str, set[str]] = {}
    for key, module in TABLE_MODULES.items():
        cols = conn.execute(f"PRAGMA table_info({module.TABLE_NAME})").fetchall()
        for c in cols:
            name = str(c["name"])
            owners.setdefault(name, set()).add(key)
    return owners


def _bfs_path(graph: dict[str, set[str]], start: str, target: str) -> list[str] | None:
    if start == target:
        return [start]
    q: deque[str] = deque([start])
    prev: dict[str, str | None] = {start: None}
    while q:
        cur = q.popleft()
        for nxt in graph[cur]:
            if nxt in prev:
                continue
            prev[nxt] = cur
            if nxt == target:
                path = [target]
                while prev[path[-1]] is not None:
                    path.append(prev[path[-1]])  # type: ignore[arg-type]
                return list(reversed(path))
            q.append(nxt)
    return None


def _choose_anchor(graph: dict[str, set[str]], tables: set[str]) -> str:
    best: tuple[int, str] | None = None
    for cand in tables:
        total = 0
        ok = True
        for t in tables:
            p = _bfs_path(graph, cand, t)
            if p is None:
                ok = False
                break
            total += len(p) - 1
        if not ok:
            continue
        score = (total, cand)
        if best is None or score < best:
            best = score
    if best is None:
        raise ValueError("Fields are not reachable across table graph.")
    return best[1]


def _edges_between(edges: list[dict[str, str]], a: str, b: str) -> list[dict[str, str]]:
    return [
        e
        for e in edges
        if (e["child"] == a and e["parent"] == b) or (e["child"] == b and e["parent"] == a)
    ]


def _expand_edge_variants(
    edges: list[dict[str, str]], table_path: list[str]
) -> list[list[dict[str, str]]]:
    variants: list[list[dict[str, str]]] = [[]]
    for i in range(len(table_path) - 1):
        a, b = table_path[i], table_path[i + 1]
        candidates = _edges_between(edges, a, b)
        if not candidates:
            raise ValueError(f"No join edge between {a} and {b}.")
        next_variants: list[list[dict[str, str]]] = []
        for cur in variants:
            for c in candidates:
                next_variants.append(cur + [c])
        variants = next_variants
    return variants


def query_arbitrary_rows(
    conn: sqlite3.Connection, reference: dict[str, Any], select_fields: list[str]
) -> list[dict[str, Any]]:
    if not reference:
        raise ValueError("reference must contain at least one field.")
    if not select_fields:
        raise ValueError("select must contain at least one field.")

    owner_map = _build_field_owner_map(conn)
    key_to_sql, fk_edges, graph = _build_fk_edges(conn)

    requested = list(reference.keys()) + list(select_fields)
    for f in requested:
        if f not in owner_map:
            raise ValueError(f"Unknown field: {f}")

    resolved: dict[str, str] = {f: next(iter(ts)) for f, ts in owner_map.items() if len(ts) == 1 and f in requested}
    anchor_tables = set(resolved.values())

    for f in requested:
        if f in resolved:
            continue
        candidates = owner_map[f]
        best_table: str | None = None
        best_score: int | None = None
        for cand in candidates:
            score = 0
            reachable = True
            for a in anchor_tables:
                p = _bfs_path(graph, cand, a)
                if p is None:
                    reachable = False
                    break
                score += len(p) - 1
            if not reachable:
                continue
            if best_score is None or score < best_score:
                best_score = score
                best_table = cand
        if best_table is None:
            raise ValueError(f"Field '{f}' is ambiguous across tables.")
        resolved[f] = best_table
        anchor_tables.add(best_table)

    select_tables = {resolved[f] for f in select_fields}

    ref_tables = {resolved[f] for f in reference}
    involved = set(ref_tables) | set(select_tables)
    anchor_pool = ref_tables if ref_tables else involved
    anchor = _choose_anchor(graph, anchor_pool)

    table_paths: dict[str, list[str]] = {}
    table_variants: dict[str, list[list[dict[str, str]]]] = {}
    for table in sorted(involved):
        if table == anchor:
            continue
        path = _bfs_path(graph, anchor, table)
        if path is None:
            raise ValueError(f"No path from {anchor} to {table}.")
        table_paths[table] = path
        table_variants[table] = _expand_edge_variants(fk_edges, path)

    where_specs = [(resolved[k], k, v) for k, v in reference.items()]

    out_rows: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    variant_tables = [t for t in sorted(involved) if t != anchor]
    variant_indices = [0] * len(variant_tables)
    variant_sizes = [len(table_variants[t]) for t in variant_tables]

    while True:
        alias_map: dict[str, str] = {anchor: "t0"}
        local_joins: list[str] = []
        alias_counter = 1

        for i, table in enumerate(variant_tables):
            path = table_paths[table]
            selected_variant = table_variants[table][variant_indices[i]]
            cur = path[0]
            for edge_idx, edge in enumerate(selected_variant):
                nxt = path[edge_idx + 1]
                if nxt in alias_map:
                    cur = nxt
                    continue
                alias_cur = alias_map[cur]
                alias_nxt = f"t{alias_counter}"
                alias_counter += 1
                alias_map[nxt] = alias_nxt
                if edge["child"] == cur and edge["parent"] == nxt:
                    on = f"{alias_cur}.{edge['from_col']} = {alias_nxt}.{edge['to_col']}"
                else:
                    on = f"{alias_nxt}.{edge['from_col']} = {alias_cur}.{edge['to_col']}"
                local_joins.append(f"INNER JOIN {key_to_sql[nxt]} {alias_nxt} ON {on}")
                cur = nxt

        select_expr = ", ".join([f"{alias_map[resolved[f]]}.{f} AS {f}" for f in select_fields])
        sql = f"SELECT {select_expr} FROM {key_to_sql[anchor]} {alias_map[anchor]} " + " ".join(local_joins)
        where_parts = [f"{alias_map[tbl]}.{col} = ?" for tbl, col, _ in where_specs]
        where_params = [v for _, _, v in where_specs]
        if where_parts:
            sql += " WHERE " + " AND ".join(where_parts)
        rows = conn.execute(sql, tuple(where_params)).fetchall()
        for r in rows:
            item = {f: r[f] for f in select_fields}
            key = tuple(item[f] for f in select_fields)
            if key not in seen:
                seen.add(key)
                out_rows.append(item)

        if not variant_tables:
            break
        carry = True
        for idx in range(len(variant_indices) - 1, -1, -1):
            if not carry:
                break
            variant_indices[idx] += 1
            if variant_indices[idx] >= variant_sizes[idx]:
                variant_indices[idx] = 0
                carry = True
            else:
                carry = False
        if carry:
            break

    return out_rows
