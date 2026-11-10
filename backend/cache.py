"""翻译结果本地缓存（SQLite），同一句不重复计费。"""
from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path

from .config import DATA_DIR

DB_PATH = DATA_DIR / "cache.db"
MAX_ROWS = 20000


def _conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tr ("
        "k TEXT PRIMARY KEY, text TEXT NOT NULL, provider TEXT, model TEXT, ts REAL)"
    )
    return conn


def key(provider: str, model: str, src: str, tgt: str, text: str) -> str:
    h = hashlib.sha256()
    h.update("\x1f".join([provider, model or "", src, tgt, text]).encode("utf-8"))
    return h.hexdigest()


def get(k: str) -> str | None:
    with _conn() as conn:
        row = conn.execute("SELECT text FROM tr WHERE k=?", (k,)).fetchone()
    return row[0] if row else None


def put(k: str, text: str, provider: str, model: str) -> None:
    with _conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO tr (k,text,provider,model,ts) VALUES (?,?,?,?,?)",
            (k, text, provider, model, time.time()),
        )
        n = conn.execute("SELECT COUNT(*) FROM tr").fetchone()[0]
        if n > MAX_ROWS:
            conn.execute(
                "DELETE FROM tr WHERE k IN (SELECT k FROM tr ORDER BY ts ASC LIMIT ?)",
                (n - MAX_ROWS,),
            )


def stats() -> dict:
    with _conn() as conn:
        n = conn.execute("SELECT COUNT(*) FROM tr").fetchone()[0]
    return {"entries": n, "size_kb": round(DB_PATH.stat().st_size / 1024, 1) if DB_PATH.exists() else 0}


def clear() -> None:
    with _conn() as conn:
        conn.execute("DELETE FROM tr")
