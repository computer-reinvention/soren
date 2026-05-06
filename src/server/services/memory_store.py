"""Semantic memory store — vector-based search over journal entries and artifacts.

Uses fastembed (BAAI/bge-small-en-v1.5, 384-dim) for embeddings and SQLite for storage.
Prototype: pure numpy cosine similarity search. Hybrid FTS5 + vector search is a future upgrade.
"""

import hashlib
import json
import sqlite3
import struct
import uuid
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded embedding model (heavy import, ~500MB first run)
_model = None


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
    return _model


def _embed(texts: list[str]) -> list[np.ndarray]:
    """Embed a list of texts, returns list of 384-dim float32 arrays."""
    model = _get_model()
    return list(model.embed(texts))


def _content_hash(text: str) -> str:
    """Fast content hash for dedup (not cryptographic)."""
    return hashlib.md5(text.encode()).hexdigest()


def _serialize_vec(vec: np.ndarray) -> bytes:
    """Serialize float32 array to bytes for SQLite BLOB storage."""
    return struct.pack(f"{len(vec)}f", *vec.astype(np.float32))


def _deserialize_vec(blob: bytes, dim: int = 384) -> np.ndarray:
    """Deserialize bytes back to float32 array."""
    return np.array(struct.unpack(f"{dim}f", blob), dtype=np.float32)


class MemoryStore:
    """SQLite-backed semantic memory with vector search."""

    EMBEDDING_DIM = 384

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (settings.soren_dir / "memories.db")
        self._ensure_db()

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _ensure_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_path TEXT,
                    keywords TEXT DEFAULT '[]',
                    tags TEXT DEFAULT '[]',
                    embedding BLOB,
                    content_hash TEXT,
                    created_at TEXT NOT NULL,
                    accessed_at TEXT,
                    access_count INTEGER DEFAULT 0
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memories_source
                ON memories(source_type, source_path)
            """)
            # Migration: add content_hash column if missing (existing DBs)
            cols = {r[1] for r in conn.execute("PRAGMA table_info(memories)").fetchall()}
            if "content_hash" not in cols:
                conn.execute("ALTER TABLE memories ADD COLUMN content_hash TEXT")
            # Migration: add project_id column for cross-project search
            if "project_id" not in cols:
                conn.execute("ALTER TABLE memories ADD COLUMN project_id TEXT DEFAULT 'soren'")
            # Backfill content_hash for existing rows
            nulls = conn.execute(
                "SELECT id, content FROM memories WHERE content_hash IS NULL"
            ).fetchall()
            if nulls:
                for row in nulls:
                    conn.execute(
                        "UPDATE memories SET content_hash = ? WHERE id = ?",
                        (_content_hash(row["content"]), row["id"]),
                    )
                logger.info("Backfilled content_hash for %d existing memories", len(nulls))
            # Remove duplicates before creating unique index (keep oldest by id)
            conn.execute("""
                DELETE FROM memories WHERE id NOT IN (
                    SELECT MIN(id) FROM memories
                    WHERE source_path IS NOT NULL AND content_hash IS NOT NULL
                    GROUP BY source_path, content_hash
                ) AND source_path IS NOT NULL AND content_hash IS NOT NULL
            """)
            conn.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_dedup
                ON memories(source_path, content_hash)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_memories_project
                ON memories(project_id)
            """)

    def add_memory(
        self,
        content: str,
        source_type: str,
        source_path: Optional[str] = None,
        keywords: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        project_id: str = "soren",
    ) -> str:
        """Add a memory entry. Embeds content and stores in DB. Returns the ID.

        Deduplicates by source_path + content_hash. Returns "" if already exists.
        """
        # Skip very short content
        if len(content.strip()) < 20:
            return ""

        c_hash = _content_hash(content)

        # Dedup check
        if source_path:
            with self._conn() as conn:
                existing = conn.execute(
                    "SELECT id FROM memories WHERE source_path = ? AND content_hash = ?",
                    (source_path, c_hash),
                ).fetchone()
                if existing:
                    return ""

        mem_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        vecs = _embed([content])
        emb_blob = _serialize_vec(vecs[0])

        with self._conn() as conn:
            conn.execute(
                """INSERT OR IGNORE INTO memories
                   (id, content, source_type, source_path, keywords, tags, embedding, content_hash, created_at, project_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    mem_id,
                    content,
                    source_type,
                    source_path,
                    json.dumps(keywords or []),
                    json.dumps(tags or []),
                    emb_blob,
                    c_hash,
                    now,
                    project_id,
                ),
            )
        return mem_id

    def add_memories_batch(
        self,
        entries: list[dict],
    ) -> int:
        """Batch-add memories. Each entry: {content, source_type, source_path, keywords, tags}.

        Returns count of entries added. Deduplicates by source_path + content_hash,
        skipping embedding for already-indexed content.
        """
        if not entries:
            return 0

        # Filter out very short content
        entries = [e for e in entries if len(e.get("content", "").strip()) >= 20]
        if not entries:
            return 0

        # Compute hashes and dedup against existing DB entries
        for e in entries:
            e["_hash"] = _content_hash(e["content"])

        with self._conn() as conn:
            existing = set()
            # Batch query existing hashes (chunked to avoid SQL param limits)
            paths = {e.get("source_path") for e in entries if e.get("source_path")}
            for path in paths:
                rows = conn.execute(
                    "SELECT content_hash FROM memories WHERE source_path = ?",
                    (path,),
                ).fetchall()
                for r in rows:
                    if r[0]:
                        existing.add((path, r[0]))

        new_entries = [
            e for e in entries
            if (e.get("source_path"), e["_hash"]) not in existing
        ]

        if not new_entries:
            return 0

        # Batch embed only new content
        texts = [e["content"] for e in new_entries]
        vecs = _embed(texts)
        now = datetime.now(timezone.utc).isoformat()

        rows = []
        for entry, vec in zip(new_entries, vecs):
            rows.append((
                str(uuid.uuid4()),
                entry["content"],
                entry["source_type"],
                entry.get("source_path"),
                json.dumps(entry.get("keywords", [])),
                json.dumps(entry.get("tags", [])),
                _serialize_vec(vec),
                entry["_hash"],
                now,
                entry.get("project_id", "soren"),
            ))

        with self._conn() as conn:
            conn.executemany(
                """INSERT OR IGNORE INTO memories
                   (id, content, source_type, source_path, keywords, tags, embedding, content_hash, created_at, project_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows,
            )
        return len(rows)

    def search(self, query: str, limit: int = 5, project_id: Optional[str] = None) -> list[dict]:
        """Search memories by semantic similarity. Returns scored results.

        Args:
            query: Search query text.
            limit: Maximum results to return.
            project_id: If provided, restrict search to this project only.
                        If None, search across ALL projects.
        """
        query_vec = _embed([query])[0]

        with self._conn() as conn:
            if project_id is not None:
                rows = conn.execute(
                    "SELECT id, content, source_type, source_path, keywords, tags, "
                    "embedding, created_at, access_count, project_id FROM memories "
                    "WHERE embedding IS NOT NULL AND project_id = ?",
                    (project_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, content, source_type, source_path, keywords, tags, "
                    "embedding, created_at, access_count, project_id FROM memories "
                    "WHERE embedding IS NOT NULL"
                ).fetchall()

        if not rows:
            return []

        # Cosine similarity via numpy
        results = []
        q_norm = query_vec / (np.linalg.norm(query_vec) + 1e-10)
        for row in rows:
            vec = _deserialize_vec(row["embedding"], self.EMBEDDING_DIM)
            v_norm = vec / (np.linalg.norm(vec) + 1e-10)
            score = float(np.dot(q_norm, v_norm))
            results.append({
                "id": row["id"],
                "content": row["content"],
                "source_type": row["source_type"],
                "source_path": row["source_path"],
                "keywords": json.loads(row["keywords"]),
                "tags": json.loads(row["tags"]),
                "score": round(score, 4),
                "created_at": row["created_at"],
                "project_id": row["project_id"] or "soren",
            })

        # Update access counts for top results
        results.sort(key=lambda x: x["score"], reverse=True)
        top = results[:limit]

        now = datetime.now(timezone.utc).isoformat()
        with self._conn() as conn:
            for r in top:
                conn.execute(
                    "UPDATE memories SET accessed_at = ?, access_count = access_count + 1 WHERE id = ?",
                    (now, r["id"]),
                )

        return top

    def get_by_id(self, mem_id: str) -> Optional[dict]:
        """Get a single memory by ID."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, content, source_type, source_path, keywords, tags, "
                "created_at, accessed_at, access_count FROM memories WHERE id = ?",
                (mem_id,),
            ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "content": row["content"],
            "source_type": row["source_type"],
            "source_path": row["source_path"],
            "keywords": json.loads(row["keywords"]),
            "tags": json.loads(row["tags"]),
            "created_at": row["created_at"],
            "accessed_at": row["accessed_at"],
            "access_count": row["access_count"],
        }

    def stats(self) -> dict:
        """Get memory store statistics."""
        with self._conn() as conn:
            total = conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
            by_type = conn.execute(
                "SELECT source_type, COUNT(*) as cnt FROM memories GROUP BY source_type"
            ).fetchall()
            by_project = conn.execute(
                "SELECT COALESCE(project_id, 'soren') as project_id, COUNT(*) as cnt "
                "FROM memories GROUP BY project_id"
            ).fetchall()
        return {
            "total": total,
            "by_type": {r["source_type"]: r["cnt"] for r in by_type},
            "by_project": {r["project_id"]: r["cnt"] for r in by_project},
        }

    def clear(self):
        """Delete all memories."""
        with self._conn() as conn:
            conn.execute("DELETE FROM memories")


memory_store = MemoryStore()
