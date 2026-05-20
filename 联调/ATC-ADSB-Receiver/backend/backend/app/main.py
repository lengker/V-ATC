from fastapi import FastAPI
from pydantic import BaseModel
import sqlite3

app = FastAPI()

class QueryRequest(BaseModel):
    sql: str
    params: list = []

@app.post("/query")
async def run_query(body: QueryRequest):
    try:
        conn = sqlite3.connect("data.sqlite3")
        cursor = conn.cursor()
        cursor.execute(body.sql, body.params)
        conn.commit()
        result = cursor.fetchall()
        conn.close()
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/health")
async def health():
    return {"ok": True}