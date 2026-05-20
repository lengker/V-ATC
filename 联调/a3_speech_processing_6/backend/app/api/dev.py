from __future__ import annotations

import sqlite3

from fastapi import APIRouter, HTTPException, Query

from app.config import get_settings
from app.db.bootstrap import (
    build_db_ui_snapshot,
    db_ui_create_row,
    db_ui_delete_row,
    db_ui_search_rows,
    db_ui_update_row,
    drop_tables_cascade,
    ensure_tables_with_ancestors,
    reset_all_tables,
    reset_table_cascade,
)
from app.db.connection import get_connection
from app.tables import lng_annotations, lng_audio_records, lng_tracks
from app.tables.registry import TABLE_MODULES

router = APIRouter(prefix="/dev", tags=["dev"])


def _ensure_dev_mode() -> None:
    if not get_settings().is_dev:
        raise HTTPException(status_code=403, detail="Development endpoints are disabled.")


@router.post("/reset/{table_key}")
def reset_single_table(table_key: str) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    with get_connection() as conn:
        recreated = reset_table_cascade(conn, table_key)
    return {"reset": table_key, "recreated_order": recreated}


@router.post("/reset-all")
def reset_everything() -> dict[str, object]:
    _ensure_dev_mode()
    with get_connection() as conn:
        recreated = reset_all_tables(conn)
    return {"reset_all": True, "recreated_order": recreated}


@router.get("/db-ui/snapshot")
def db_ui_snapshot(
    limit: int = Query(default=100, ge=1, le=1000),
) -> dict[str, object]:
    _ensure_dev_mode()
    with get_connection() as conn:
        tables = build_db_ui_snapshot(conn, row_limit=limit)
    return {"tables": tables}


@router.post("/db-ui/drop/{table_key}")
def db_ui_drop_table(table_key: str) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    with get_connection() as conn:
        dropped_order = drop_tables_cascade(conn, table_key)
    return {"dropped": table_key, "dropped_order": dropped_order}


@router.post("/db-ui/ensure/{table_key}")
def db_ui_ensure_table(table_key: str) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    with get_connection() as conn:
        created_or_skipped = ensure_tables_with_ancestors(conn, table_key)
    return {"ensure": table_key, "created_or_skipped": created_or_skipped}


@router.post("/db-ui/rows/create/{table_key}")
def db_ui_create_table_row(table_key: str, payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    values = payload.get("values", payload)
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return db_ui_create_row(conn, table_key, values)
    except (ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/delete/{table_key}")
def db_ui_delete_table_row(table_key: str, payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return db_ui_delete_row(conn, table_key, pk_value)
    except (ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/search/{table_key}")
def db_ui_search_table_rows(table_key: str, payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return db_ui_search_rows(conn, table_key, filters, limit=search_limit)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/update/{table_key}")
def db_ui_update_table_row(table_key: str, payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    pk_value = payload.get("id")
    new_pk_value = payload.get("new_id")
    values = payload.get("values", {})
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return db_ui_update_row(conn, table_key, pk_value, values, new_pk_value)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/tracks/ext/create")
def db_ui_create_tracks_extended(payload: dict[str, object] | list[dict[str, object]]) -> dict[str, object] | list[dict[str, object]]:
    _ensure_dev_mode()
    try:
        with get_connection() as conn:
            return lng_tracks.create_items_extended(conn, payload)
    except (ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/tracks/ext/delete")
def db_ui_delete_tracks_extended(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            item_id = int(pk_value)
            chain_ids = lng_tracks.collect_chain_ids(conn, item_id)
            for chain_id in chain_ids:
                db_ui_delete_row(conn, "tracks", chain_id)
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True, "ids": chain_ids, "count": len(chain_ids)}


@router.post("/db-ui/rows/tracks/ext/update")
def db_ui_update_tracks_extended(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    values = payload.get("values", {})
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_tracks.update_item_extended(conn, int(pk_value), values)
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/tracks/ext/search")
def db_ui_search_tracks_extended(payload: dict[str, object]) -> dict[str, object] | list[dict[str, object]]:
    _ensure_dev_mode()
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            search_result = db_ui_search_rows(conn, "tracks", filters, limit=search_limit)
            return lng_tracks.build_aggregated_search_result(conn, search_result["rows"])
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- dev: audio_records chain extensions ---


@router.post("/db-ui/rows/audio_records/ext/create")
def db_ui_create_audio_records_extended(
    payload: dict[str, object] | list[dict[str, object]],
) -> dict[str, object] | list[dict[str, object]]:
    _ensure_dev_mode()
    try:
        with get_connection() as conn:
            return lng_audio_records.create_items_chain_extended(conn, payload)
    except (ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/audio_records/ext/delete-chain")
def db_ui_delete_audio_records_chain(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_audio_records.delete_chain_extended(conn, int(pk_value))
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/audio_records/ext/delete-one")
def db_ui_delete_audio_records_one(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_audio_records.delete_one_extended(conn, int(pk_value))
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/audio_records/ext/search-all")
def db_ui_search_audio_records_chains_all(payload: dict[str, object]) -> object:
    _ensure_dev_mode()
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_audio_records.search_chains_all(conn, filters, search_limit)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/audio_records/ext/search-one")
def db_ui_search_audio_records_chains_one(payload: dict[str, object]) -> list[dict[str, object]]:
    _ensure_dev_mode()
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_audio_records.search_chains_one(conn, filters, search_limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/audio_records/ext/update")
def db_ui_update_audio_records_chain_only(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    values = payload.get("values", {})
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_audio_records.update_item_chain_only(conn, int(pk_value), values)
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- dev: annotations chain extensions ---


@router.post("/db-ui/rows/annotations/ext/create")
def db_ui_create_annotations_extended(
    payload: dict[str, object] | list[dict[str, object]],
) -> dict[str, object] | list[dict[str, object]]:
    _ensure_dev_mode()
    try:
        with get_connection() as conn:
            return lng_annotations.create_items_chain_extended(conn, payload)
    except (ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/annotations/ext/delete-chain")
def db_ui_delete_annotations_chain(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_annotations.delete_chain_extended(conn, int(pk_value))
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/annotations/ext/delete-one")
def db_ui_delete_annotations_one(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_annotations.delete_one_extended(conn, int(pk_value))
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/annotations/ext/search-all")
def db_ui_search_annotations_chains_all(payload: dict[str, object]) -> object:
    _ensure_dev_mode()
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_annotations.search_chains_all(conn, filters, search_limit)
    except (ValueError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/annotations/ext/search-one")
def db_ui_search_annotations_chains_one(payload: dict[str, object]) -> list[dict[str, object]]:
    _ensure_dev_mode()
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_annotations.search_chains_one(conn, filters, search_limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/db-ui/rows/annotations/ext/update")
def db_ui_update_annotations_chain_only(payload: dict[str, object]) -> dict[str, object]:
    _ensure_dev_mode()
    pk_value = payload.get("id")
    values = payload.get("values", {})
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_annotations.update_item_chain_only(conn, int(pk_value), values)
    except (ValueError, KeyError, sqlite3.IntegrityError, TypeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
