from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.db.connection import get_connection
from app.db.bootstrap import db_ui_delete_row, db_ui_search_rows
from app.tables import lng_annotations, lng_audio_records, lng_tracks
from app.tables.registry import TABLE_MODULES

router = APIRouter(prefix="/tables", tags=["tables"])


def _parse_item_id(module: Any, item_id: str) -> int | str:
    if module.PK_COLUMN.endswith("_id"):
        return int(item_id)
    return item_id


@router.post("/{table_key}")
def create_item(table_key: str, payload: dict[str, Any]) -> dict[str, Any]:
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    module = TABLE_MODULES[table_key]
    try:
        with get_connection() as conn:
            item_id = module.create_item(conn, payload)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": item_id}


@router.post("/tracks/ext/create")
def create_tracks_extended(payload: dict[str, Any] | list[dict[str, Any]]) -> dict[str, Any] | list[dict[str, Any]]:
    try:
        with get_connection() as conn:
            return lng_tracks.create_items_extended(conn, payload)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{table_key}/{item_id}")
def get_item(table_key: str, item_id: str) -> dict[str, Any]:
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    module = TABLE_MODULES[table_key]
    parsed_id = _parse_item_id(module, item_id)
    with get_connection() as conn:
        row = module.get_item(conn, parsed_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return row


@router.get("/{table_key}")
def list_items(
    table_key: str,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    module = TABLE_MODULES[table_key]
    with get_connection() as conn:
        return module.list_items(conn, limit=limit, offset=offset)


@router.put("/{table_key}/{item_id}")
def update_item(table_key: str, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    module = TABLE_MODULES[table_key]
    parsed_id = _parse_item_id(module, item_id)
    try:
        with get_connection() as conn:
            updated = module.update_item(conn, parsed_id, payload)
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found or no fields changed")
    return {"updated": True}


@router.delete("/{table_key}/{item_id}")
def delete_item(table_key: str, item_id: str) -> dict[str, Any]:
    if table_key not in TABLE_MODULES:
        raise HTTPException(status_code=404, detail="Unknown table")
    module = TABLE_MODULES[table_key]
    parsed_id = _parse_item_id(module, item_id)
    with get_connection() as conn:
        deleted = module.delete_item(conn, parsed_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"deleted": True}


@router.post("/tracks/ext/delete")
def delete_tracks_extended(payload: dict[str, Any]) -> dict[str, Any]:
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            item_id = int(pk_value)
            chain_ids = lng_tracks.collect_chain_ids(conn, item_id)
            for chain_id in chain_ids:
                db_ui_delete_row(conn, "tracks", chain_id)
    except (TypeError, ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"deleted": True, "ids": chain_ids, "count": len(chain_ids)}


@router.post("/tracks/ext/update/{item_id}")
def update_tracks_extended(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    values = payload.get("values", payload)
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_tracks.update_item_extended(conn, item_id, values)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/tracks/ext/search")
def search_tracks_extended(payload: dict[str, Any]) -> dict[str, Any] | list[dict[str, Any]]:
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


# --- audio_records chain extensions ---


@router.post("/audio_records/ext/create")
def create_audio_records_extended(
    payload: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any] | list[dict[str, Any]]:
    try:
        with get_connection() as conn:
            return lng_audio_records.create_items_chain_extended(conn, payload)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio_records/ext/delete-chain")
def delete_audio_records_chain(payload: dict[str, Any]) -> dict[str, Any]:
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_audio_records.delete_chain_extended(conn, int(pk_value))
    except (TypeError, ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio_records/ext/delete-one")
def delete_audio_records_one(payload: dict[str, Any]) -> dict[str, Any]:
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_audio_records.delete_one_extended(conn, int(pk_value))
    except (TypeError, ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio_records/ext/search-all")
def search_audio_records_chains_all(payload: dict[str, Any]) -> Any:
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


@router.post("/audio_records/ext/search-one")
def search_audio_records_chains_one(payload: dict[str, Any]) -> list[dict[str, Any]]:
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_audio_records.search_chains_one(conn, filters, search_limit)
    except ValueError as exc:
        msg = str(exc)
        if "Multiple audio chains" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/audio_records/ext/update/{item_id}")
def update_audio_records_chain_only(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    values = payload.get("values", payload)
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_audio_records.update_item_chain_only(conn, item_id, values)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# --- annotations chain extensions ---


@router.post("/annotations/ext/create")
def create_annotations_extended(
    payload: dict[str, Any] | list[dict[str, Any]],
) -> dict[str, Any] | list[dict[str, Any]]:
    try:
        with get_connection() as conn:
            return lng_annotations.create_items_chain_extended(conn, payload)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/annotations/ext/delete-chain")
def delete_annotations_chain(payload: dict[str, Any]) -> dict[str, Any]:
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_annotations.delete_chain_extended(conn, int(pk_value))
    except (TypeError, ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/annotations/ext/delete-one")
def delete_annotations_one(payload: dict[str, Any]) -> dict[str, Any]:
    pk_value = payload.get("id")
    try:
        with get_connection() as conn:
            return lng_annotations.delete_one_extended(conn, int(pk_value))
    except (TypeError, ValueError, KeyError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/annotations/ext/search-all")
def search_annotations_chains_all(payload: dict[str, Any]) -> Any:
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


@router.post("/annotations/ext/search-one")
def search_annotations_chains_one(payload: dict[str, Any]) -> list[dict[str, Any]]:
    filters = payload.get("filters", payload)
    limit = payload.get("limit", 100)
    if not isinstance(filters, dict):
        raise HTTPException(status_code=400, detail="filters must be an object")
    try:
        search_limit = int(limit)
        with get_connection() as conn:
            return lng_annotations.search_chains_one(conn, filters, search_limit)
    except ValueError as exc:
        msg = str(exc)
        if "Multiple annotation chains" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=400, detail=msg) from exc
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/annotations/ext/update/{item_id}")
def update_annotations_chain_only(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    values = payload.get("values", payload)
    if not isinstance(values, dict):
        raise HTTPException(status_code=400, detail="values must be an object")
    try:
        with get_connection() as conn:
            return lng_annotations.update_item_chain_only(conn, item_id, values)
    except (sqlite3.IntegrityError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
