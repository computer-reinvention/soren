"""Task dependency DAG — directed acyclic graph for task ordering.

Manages the task_dependencies table in tasks.db. Provides cycle detection,
topological sort, and "ready tasks" computation (all deps satisfied).

Edge semantics: (task_id, depends_on) means task_id WAITS FOR depends_on.
Arrow direction in DAG: depends_on → task_id (dep must complete first).
"""

import sqlite3
from collections import deque
from contextlib import contextmanager
from typing import Optional

from ..config import settings

DB_PATH = settings.soren_dir / "tasks.db"


@contextmanager
def _conn():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def ensure_table() -> None:
    """Create task_dependencies table if it doesn't exist (idempotent)."""
    if not DB_PATH.exists():
        return  # DB not yet created; called again on first task add
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS task_dependencies (
                task_id    TEXT NOT NULL,
                depends_on TEXT NOT NULL,
                PRIMARY KEY (task_id, depends_on),
                FOREIGN KEY (task_id)    REFERENCES tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (depends_on) REFERENCES tasks(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_task_deps_dep
            ON task_dependencies(depends_on)
        """)


# Run migration at import time (no-op if already exists or DB missing)
ensure_table()


# ── Cycle detection ────────────────────────────────────────────────────────────

def _can_reach(conn: sqlite3.Connection, start: str, target: str) -> bool:
    """DFS: can we reach `target` from `start` following depends_on edges?"""
    visited: set[str] = set()
    stack = [start]
    while stack:
        current = stack.pop()
        if current == target:
            return True
        if current in visited:
            continue
        visited.add(current)
        rows = conn.execute(
            "SELECT depends_on FROM task_dependencies WHERE task_id = ?", (current,)
        ).fetchall()
        stack.extend(r["depends_on"] for r in rows)
    return False


def detect_cycle(task_id: str, new_dep_id: str) -> bool:
    """Return True if adding task_id → new_dep_id would create a cycle."""
    if task_id == new_dep_id:
        return True
    with _conn() as conn:
        return _can_reach(conn, new_dep_id, task_id)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def add_dependency(task_id: str, depends_on_id: str) -> None:
    """Add dependency edge: task_id must wait for depends_on_id to complete.

    Raises ValueError if either task doesn't exist or edge would create a cycle.
    """
    with _conn() as conn:
        for tid, label in [(task_id, "task"), (depends_on_id, "dependency")]:
            if not conn.execute("SELECT id FROM tasks WHERE id = ?", (tid,)).fetchone():
                raise ValueError(f"{label} not found: {tid}")

        if task_id == depends_on_id or _can_reach(conn, depends_on_id, task_id):
            raise ValueError(
                f"Adding {task_id} → {depends_on_id} would create a cycle"
            )

        conn.execute(
            "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
            (task_id, depends_on_id),
        )


def remove_dependency(task_id: str, depends_on_id: str) -> bool:
    """Remove a dependency edge. Returns True if the edge existed."""
    with _conn() as conn:
        cursor = conn.execute(
            "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on = ?",
            (task_id, depends_on_id),
        )
        return cursor.rowcount > 0


def get_dependencies(task_id: str) -> list[str]:
    """Return task IDs that task_id directly depends on (must complete first)."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT depends_on FROM task_dependencies WHERE task_id = ?", (task_id,)
        ).fetchall()
    return [r["depends_on"] for r in rows]


def get_dependents(task_id: str) -> list[str]:
    """Return task IDs that directly depend on task_id (blocked until this completes)."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT task_id FROM task_dependencies WHERE depends_on = ?", (task_id,)
        ).fetchall()
    return [r["task_id"] for r in rows]


# ── DAG queries ───────────────────────────────────────────────────────────────

def get_ready_tasks(project_id: Optional[str] = None) -> list[str]:
    """Return task IDs that are pending/assigned with all dependencies satisfied.

    A task is "ready" when every task it depends on has status done or verified.
    Tasks with no dependencies are always ready (if their status allows).
    """
    with _conn() as conn:
        params: list = []
        where = "status IN ('pending', 'assigned')"
        if project_id:
            where += " AND project = ?"
            params.append(project_id)

        candidates = conn.execute(
            f"SELECT id FROM tasks WHERE {where}", params
        ).fetchall()

        if not candidates:
            return []

        candidate_ids = [r["id"] for r in candidates]
        placeholders = ",".join("?" * len(candidate_ids))

        # Tasks that have at least one unmet dependency
        blocked = conn.execute(
            f"""SELECT DISTINCT d.task_id
                FROM task_dependencies d
                JOIN tasks t ON d.depends_on = t.id
                WHERE d.task_id IN ({placeholders})
                AND t.status NOT IN ('done', 'verified')""",
            candidate_ids,
        ).fetchall()
        blocked_set = {r["task_id"] for r in blocked}

    return [tid for tid in candidate_ids if tid not in blocked_set]


def topological_sort(project_id: Optional[str] = None) -> list[str]:
    """Return active task IDs in dependency-first order (Kahn's algorithm).

    Done/verified/failed tasks are excluded. Tasks with no deps come first.
    Stable sort within a level (alphabetical by id). Cycles are appended last.
    """
    with _conn() as conn:
        params: list = []
        where = "status NOT IN ('done', 'verified', 'failed')"
        if project_id:
            where += " AND project = ?"
            params.append(project_id)

        task_rows = conn.execute(
            f"SELECT id FROM tasks WHERE {where}", params
        ).fetchall()
        task_ids = {r["id"] for r in task_rows}

        if not task_ids:
            return []

        placeholders = ",".join("?" * len(task_ids))
        dep_rows = conn.execute(
            f"""SELECT task_id, depends_on FROM task_dependencies
                WHERE task_id IN ({placeholders}) AND depends_on IN ({placeholders})""",
            list(task_ids) + list(task_ids),
        ).fetchall()

    # Build Kahn's in-degree map and adjacency list (dep → dependents)
    in_degree: dict[str, int] = {tid: 0 for tid in task_ids}
    dependents: dict[str, list[str]] = {tid: [] for tid in task_ids}

    for row in dep_rows:
        tid, dep = row["task_id"], row["depends_on"]
        if tid in task_ids and dep in task_ids:
            in_degree[tid] += 1
            dependents[dep].append(tid)

    queue = deque(sorted(tid for tid in task_ids if in_degree[tid] == 0))
    result: list[str] = []

    while queue:
        current = queue.popleft()
        result.append(current)
        for dep_tid in sorted(dependents.get(current, [])):
            in_degree[dep_tid] -= 1
            if in_degree[dep_tid] == 0:
                queue.append(dep_tid)

    # Append remaining (cycle members — shouldn't happen with validated adds)
    result.extend(sorted(tid for tid in task_ids if tid not in set(result)))
    return result


def get_full_dag(project_id: Optional[str] = None) -> dict:
    """Return the full DAG as {nodes: [...], edges: [{from, to}, ...]}.

    Edge direction: from=dependency, to=dependent (dep must come first).
    """
    with _conn() as conn:
        params: list = []
        where = ""
        if project_id:
            where = "WHERE project = ?"
            params.append(project_id)

        task_rows = conn.execute(
            f"SELECT id, title, status, priority, assigned_to FROM tasks {where}",
            params,
        ).fetchall()
        task_ids = {r["id"] for r in task_rows}

        edge_rows = []
        if task_ids:
            placeholders = ",".join("?" * len(task_ids))
            edge_rows = conn.execute(
                f"""SELECT task_id, depends_on FROM task_dependencies
                    WHERE task_id IN ({placeholders}) OR depends_on IN ({placeholders})""",
                list(task_ids) + list(task_ids),
            ).fetchall()

    nodes = [
        {
            "id": r["id"],
            "title": r["title"],
            "status": r["status"],
            "priority": r["priority"],
            "assigned_to": r["assigned_to"],
        }
        for r in task_rows
    ]
    edges = [
        {"from": r["depends_on"], "to": r["task_id"]}
        for r in edge_rows
    ]
    return {"nodes": nodes, "edges": edges}
