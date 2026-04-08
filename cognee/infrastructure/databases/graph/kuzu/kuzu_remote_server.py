"""
Kuzu Remote Server — a thin FastAPI wrapper around embedded Kuzu databases.

Supports per-database routing so each Cognee dataset can have its own
isolated graph.  Databases are created lazily on first query and stored
under ``DATA_DIR/<database_name>/``.

Concurrency model
-----------------
All Kuzu operations are **blocking**, and a single ``Connection`` is not
safe for concurrent use.  We therefore:

1. Keep **one write Connection** and a **pool of read Connections** per
   database.
2. Writes (CREATE, MERGE, DELETE, DROP, SET, REMOVE, ALTER, COPY) acquire
   an exclusive write lock — only one writer at a time, no concurrent
   readers.
3. Reads (MATCH, RETURN, CALL, etc.) acquire a shared read lock — many
   readers can run concurrently, but they wait for any active writer.
4. All blocking ``conn.execute()`` calls run in a thread-pool via
   ``loop.run_in_executor`` so the FastAPI event loop stays responsive.

This means **many Cognee processes / workers** can hit the server
concurrently without file-locking issues — the server serialises writes
per database while allowing concurrent reads.

Endpoints
---------
POST /query             — execute a Cypher query (body: {database, query, parameters})
DELETE /database/{name} — drop a database directory
GET  /health            — liveness probe

Run directly:
    python -m cognee.infrastructure.databases.graph.kuzu.kuzu_remote_server

Environment variables:
    KUZU_DATA_DIR       — root directory for database files (default: /data/kuzu)
    KUZU_HOST           — bind address (default: 0.0.0.0)
    KUZU_PORT           — bind port (default: 8182)
    KUZU_WORKERS        — thread-pool size (default: 4)
    KUZU_READ_POOL_SIZE — read connections per database (default: 4)
"""

import os
import re
import json
import shutil
import asyncio
import logging
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional
from contextlib import asynccontextmanager

import kuzu
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logger = logging.getLogger("kuzu_remote_server")

DATA_DIR = Path(os.environ.get("KUZU_DATA_DIR", "/data/kuzu"))
DEFAULT_DB = "default"
READ_POOL_SIZE = int(os.environ.get("KUZU_READ_POOL_SIZE", "4"))

_WRITE_KEYWORDS = re.compile(
    r"^\s*(CREATE|MERGE|DELETE|DETACH|DROP|SET|REMOVE|ALTER|COPY)\b",
    re.IGNORECASE | re.MULTILINE,
)

_executor = ThreadPoolExecutor(max_workers=int(os.environ.get("KUZU_WORKERS", "4")))


class _DatabaseSlot:
    """Holds one Kuzu Database and its connections + synchronisation primitives."""

    def __init__(self, db_name: str):
        db_path = DATA_DIR / db_name
        DATA_DIR.mkdir(parents=True, exist_ok=True)

        self.name = db_name
        self.db = kuzu.Database(str(db_path))
        self.write_conn = kuzu.Connection(self.db)

        self.read_conns: asyncio.Queue[kuzu.Connection] = asyncio.Queue()
        for _ in range(READ_POOL_SIZE):
            self.read_conns.put_nowait(kuzu.Connection(self.db))

        self.rw_lock = asyncio.Lock()
        self.readers_count = 0
        self.readers_lock = asyncio.Lock()

    def close(self):
        self.write_conn.close()
        while not self.read_conns.empty():
            self.read_conns.get_nowait().close()
        self.db.close()


_slots: Dict[str, _DatabaseSlot] = {}
_global_lock = asyncio.Lock()


async def _get_slot(db_name: str) -> _DatabaseSlot:
    if db_name not in _slots:
        async with _global_lock:
            if db_name not in _slots:
                _slots[db_name] = _DatabaseSlot(db_name)
    return _slots[db_name]


def _is_write_query(query: str) -> bool:
    return bool(_WRITE_KEYWORDS.search(query))


def _execute_sync(conn: kuzu.Connection, query: str, parameters: dict) -> dict:
    """Run a Kuzu query synchronously — called inside the thread-pool."""
    result = conn.execute(query, parameters=parameters)

    rows: List[List[Any]] = []
    columns: List[str] = result.get_column_names() if result.has_next() else []

    while result.has_next():
        row = result.get_next()
        serialised = []
        for val in row:
            try:
                json.dumps(val)
                serialised.append(val)
            except (TypeError, ValueError):
                serialised.append(str(val))
        rows.append(serialised)

    return {"data": rows, "columns": columns}


async def _execute_write(slot: _DatabaseSlot, query: str, parameters: dict) -> dict:
    """Exclusive write — waits for all readers to finish, blocks new readers."""
    async with slot.rw_lock:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor, _execute_sync, slot.write_conn, query, parameters
        )


async def _execute_read(slot: _DatabaseSlot, query: str, parameters: dict) -> dict:
    """Shared read — multiple readers run concurrently, but wait for any active writer."""
    async with slot.readers_lock:
        slot.readers_count += 1
        if slot.readers_count == 1:
            await slot.rw_lock.acquire()
    try:
        conn = await slot.read_conns.get()
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                _executor, _execute_sync, conn, query, parameters
            )
        finally:
            await slot.read_conns.put(conn)
    finally:
        async with slot.readers_lock:
            slot.readers_count -= 1
            if slot.readers_count == 0:
                slot.rw_lock.release()


@asynccontextmanager
async def lifespan(app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    yield
    for slot in _slots.values():
        slot.close()
    _executor.shutdown(wait=False)


app = FastAPI(title="Kuzu Remote Server", lifespan=lifespan)


class QueryRequest(BaseModel):
    query: str
    parameters: Optional[Dict[str, Any]] = None
    database: Optional[str] = None


class QueryResponse(BaseModel):
    data: List[List[Any]]
    columns: Optional[List[str]] = None


@app.post("/query", response_model=QueryResponse)
async def execute_query(req: QueryRequest):
    db_name = req.database or DEFAULT_DB

    try:
        slot = await _get_slot(db_name)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to open database '{db_name}': {exc}",
        )

    try:
        if _is_write_query(req.query):
            result = await _execute_write(slot, req.query, req.parameters or {})
        else:
            result = await _execute_read(slot, req.query, req.parameters or {})
        return QueryResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/database/{name}")
async def delete_database(name: str):
    slot = _slots.pop(name, None)
    if slot is not None:
        async with slot.rw_lock:
            slot.close()

    db_path = DATA_DIR / name
    if db_path.exists():
        if db_path.is_dir():
            shutil.rmtree(db_path)
        else:
            db_path.unlink()
        return {"status": "deleted", "database": name}

    return {"status": "not_found", "database": name}


@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    host = os.environ.get("KUZU_HOST", "0.0.0.0")
    port = int(os.environ.get("KUZU_PORT", "8182"))
    uvicorn.run(app, host=host, port=port)
