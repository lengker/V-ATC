from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.bootstrap import query_arbitrary_rows
from app.db.connection import get_connection

router = APIRouter(prefix="/query", tags=["query"])


class ArbitraryQueryRequest(BaseModel):
    reference: dict[str, Any] = Field(..., min_length=1)
    select: list[str] = Field(..., min_length=1)


@router.post("/arbitrary")
def arbitrary_query(req: ArbitraryQueryRequest) -> list[dict[str, Any]]:
    try:
        with get_connection() as conn:
            return query_arbitrary_rows(conn, req.reference, req.select)
    except (ValueError, sqlite3.IntegrityError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

