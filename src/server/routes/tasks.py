"""Tasks API routes — read/update tasks from .soren/tasks.db (shared with tools/tasks CLI)."""

import json
import logging
import random
import sqlite3
import string
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..config import settings
from ..services import task_dag
from ..services import blocker_detector

logger = logging.getLogger(__name__)

router = APIRouter()

DB_PATH = settings.soren_dir / "tasks.db"

VALID_STATUSES = {"backlog", "pending", "assigned", "in-progress", "review", "done", "verified", "blocked", "failed"}
VALID_PRIORITIES = {"critical", "high", "medium", "low"}
VALID_SOURCES = {"user", "backlog", "self-generated", "worker-escalation", "system"}


# --- Models ---


class TaskResponse(BaseModel):
    id: str
    title: str
    description: str
    project: str
    assigned_to: str
    status: str
    priority: str
    source: str
    linked_workers: str
    parent_id: str
    resources: list[str]
    created_at: str
    updated_at: str
    completed_at: str
    remarks: str
    tags: list[str]
    due_date: str
    children: Optional[list["TaskResponse"]] = None
    # DAG fields — populated by specific endpoints; default empty
    depends_on: list[str] = []    # task IDs this task waits for
    blocked_by: list[str] = []    # task IDs not yet done that block this task
    ready: bool = True            # True if all deps are done/verified
    duration_seconds: Optional[int] = None  # computed on completion
    # Blocker detection — populated on in-progress transitions and /blockers endpoints
    blockers: Optional[list[dict]] = None  # None = not checked; [] = checked, none found


class TaskListResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int


class TaskTreeResponse(BaseModel):
    tasks: list[TaskResponse]
    total: int


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    project: Optional[str] = ""
    priority: Optional[str] = "medium"
    source: Optional[str] = "system"
    parent_id: Optional[str] = ""
    assigned_to: Optional[str] = ""
    resources: Optional[list[str]] = []
    tags: Optional[list[str]] = []
    due_date: Optional[str] = ""


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    priority: Optional[str] = None
    source: Optional[str] = None
    remarks: Optional[str] = None
    tags: Optional[list[str]] = None
    due_date: Optional[str] = None


class TaskStatsResponse(BaseModel):
    total: int
    by_status: dict[str, int]
    by_priority: dict[str, int]
    by_assignee: dict[str, int]
    needs_attention: list[TaskResponse]


# --- Database ---


_migrated = False

@contextmanager
def _get_connection():
    """Get a database connection with WAL mode and proper cleanup."""
    global _migrated
    if not DB_PATH.exists():
        raise HTTPException(status_code=404, detail="tasks.db not found — no tasks created yet")
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    if not _migrated:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
        if "duration_seconds" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN duration_seconds INTEGER")
        # Backfill duration for completed tasks missing it
        conn.execute(
            """UPDATE tasks SET duration_seconds = CAST((julianday(completed_at) - julianday(created_at)) * 86400 AS INTEGER)
            WHERE status IN ('done', 'verified', 'failed')
            AND completed_at IS NOT NULL AND length(completed_at) > 0
            AND duration_seconds IS NULL"""
        )
        _migrated = True
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _gen_id() -> str:
    """Generate a task ID matching the CLI format: t_ + 8 alphanumeric chars."""
    chars = string.ascii_lowercase + string.digits
    return "t_" + "".join(random.choice(chars) for _ in range(8))


def _row_to_task(row: sqlite3.Row) -> TaskResponse:
    """Convert a database row to a TaskResponse."""
    resources_raw = row["resources"]
    try:
        resources = json.loads(resources_raw) if resources_raw else []
    except (json.JSONDecodeError, TypeError):
        resources = []

    # Safely read columns that may not exist in older schemas
    keys = row.keys()

    # Parse tags JSON
    tags_raw = row["tags"] if "tags" in keys else "[]"
    try:
        tags = json.loads(tags_raw) if tags_raw else []
    except (json.JSONDecodeError, TypeError):
        tags = []

    return TaskResponse(
        id=row["id"],
        title=row["title"],
        description=row["description"] or "",
        project=row["project"] or "",
        assigned_to=row["assigned_to"] or "",
        status=row["status"] or "pending",
        priority=(row["priority"] or "medium") if "priority" in keys else "medium",
        source=(row["source"] or "system") if "source" in keys else "system",
        linked_workers=(row["linked_workers"] or "") if "linked_workers" in keys else "",
        parent_id=row["parent_id"] or "",
        resources=resources,
        created_at=row["created_at"] or "",
        updated_at=row["updated_at"] or "",
        completed_at=row["completed_at"] or "",
        remarks=(row["remarks"] or "") if "remarks" in keys else "",
        tags=tags,
        due_date=(row["due_date"] or "") if "due_date" in keys else "",
        duration_seconds=row["duration_seconds"] if "duration_seconds" in keys else None,
    )


# --- Routes ---


@router.get("", response_model=TaskListResponse)
async def list_tasks(
    project: Optional[str] = Query(None, description="Filter by project ID"),
    status: Optional[str] = Query(None, description="Filter by status"),
    assigned_to: Optional[str] = Query(None, description="Filter by assignee"),
    parent_id: Optional[str] = Query(None, description="Filter by parent task ID"),
    include_done: bool = Query(False, description="Include done tasks"),
    tag: Optional[str] = Query(None, description="Filter tasks where tags contains this value"),
    due_before: Optional[str] = Query(None, description="Filter tasks where due_date <= this ISO datetime"),
):
    """List tasks with optional filters."""
    with _get_connection() as conn:
        conditions: list[str] = []
        params: list = []

        if not include_done and status != "done":
            conditions.append("status != 'done'")

        if project is not None:
            conditions.append("project = ?")
            params.append(project)

        if status is not None:
            conditions.append("status = ?")
            params.append(status)

        if assigned_to is not None:
            conditions.append("assigned_to = ?")
            params.append(assigned_to)

        if parent_id is not None:
            conditions.append("parent_id = ?")
            params.append(parent_id)

        if tag is not None:
            # SQLite JSON: check if tags array contains the value
            conditions.append("EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)")
            params.append(tag)

        if due_before is not None:
            conditions.append("due_date != '' AND due_date <= ?")
            params.append(due_before)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        cursor = conn.execute(
            f"SELECT * FROM tasks {where} ORDER BY created_at",
            params,
        )
        rows = cursor.fetchall()
        tasks = [_row_to_task(row) for row in rows]

        return TaskListResponse(tasks=tasks, total=len(tasks))


@router.get("/tree", response_model=TaskTreeResponse)
async def get_task_tree(
    project: Optional[str] = Query(None, description="Filter by project ID"),
    include_done: bool = Query(False, description="Include done tasks"),
):
    """Get hierarchical task tree — top-level tasks with nested children."""
    with _get_connection() as conn:
        conditions: list[str] = []
        params: list = []

        if not include_done:
            conditions.append("status != 'done'")

        if project is not None:
            conditions.append("project = ?")
            params.append(project)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        cursor = conn.execute(
            f"SELECT * FROM tasks {where} ORDER BY created_at",
            params,
        )
        all_tasks = [_row_to_task(row) for row in cursor.fetchall()]

    # Build tree: index by parent_id
    by_parent: dict[str, list[TaskResponse]] = {}
    task_map: dict[str, TaskResponse] = {}
    for task in all_tasks:
        task_map[task.id] = task
        parent_key = task.parent_id or ""
        if parent_key not in by_parent:
            by_parent[parent_key] = []
        by_parent[parent_key].append(task)

    def _attach_children(task: TaskResponse) -> TaskResponse:
        children = by_parent.get(task.id, [])
        if children:
            task.children = [_attach_children(c) for c in children]
        else:
            task.children = []
        return task

    # Root tasks have empty parent_id
    roots = by_parent.get("", [])
    tree = [_attach_children(t) for t in roots]

    return TaskTreeResponse(tasks=tree, total=len(all_tasks))


@router.get("/stats", response_model=TaskStatsResponse)
async def get_task_stats():
    """Dashboard stats: counts by status, priority, assignee, plus attention items."""
    with _get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]

        # By status
        status_rows = conn.execute(
            "SELECT status, COUNT(*) as cnt FROM tasks GROUP BY status"
        ).fetchall()
        by_status = {row["status"]: row["cnt"] for row in status_rows}

        # By priority (active tasks only)
        priority_rows = conn.execute(
            "SELECT COALESCE(NULLIF(priority,''), 'medium') as pri, COUNT(*) as cnt "
            "FROM tasks WHERE status NOT IN ('done', 'failed') GROUP BY pri"
        ).fetchall()
        by_priority = {row["pri"]: row["cnt"] for row in priority_rows}

        # By assignee (active tasks only)
        assignee_rows = conn.execute(
            "SELECT CASE WHEN assigned_to = '' THEN '(unassigned)' ELSE assigned_to END as agent, "
            "COUNT(*) as cnt FROM tasks WHERE status NOT IN ('done', 'failed') GROUP BY agent"
        ).fetchall()
        by_assignee = {row["agent"]: row["cnt"] for row in assignee_rows}

        # Needs attention: blocked, failed, or critical+pending
        attention_rows = conn.execute(
            "SELECT * FROM tasks WHERE status IN ('blocked', 'failed') "
            "OR (priority = 'critical' AND status NOT IN ('done', 'failed')) "
            "ORDER BY CASE status WHEN 'failed' THEN 1 WHEN 'blocked' THEN 2 ELSE 3 END"
        ).fetchall()
        needs_attention = [_row_to_task(row) for row in attention_rows]

        return TaskStatsResponse(
            total=total,
            by_status=by_status,
            by_priority=by_priority,
            by_assignee=by_assignee,
            needs_attention=needs_attention,
        )


@router.get("/reminders/due", response_model=TaskListResponse)
async def get_due_reminders():
    """Return tasks tagged 'reminder' with due_date <= now and status != 'done'."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with _get_connection() as conn:
        cursor = conn.execute(
            "SELECT * FROM tasks "
            "WHERE status != 'done' "
            "AND due_date != '' AND due_date <= ? "
            "AND EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = 'reminder') "
            "ORDER BY due_date",
            (now,),
        )
        rows = cursor.fetchall()
        tasks = [_row_to_task(row) for row in rows]
        return TaskListResponse(tasks=tasks, total=len(tasks))


@router.get("/blockers")
async def get_all_blockers(
    project: Optional[str] = Query(None, description="Filter by project ID"),
):
    """Scan all active tasks for blockers (unmet deps + missing code artifacts)."""
    return blocker_detector.scan_all_active_tasks(project_id=project)


@router.get("/dag")
async def get_dag(project: Optional[str] = Query(None, description="Filter by project ID")):
    """Return the full dependency DAG as {nodes, edges}.

    Edge direction: from=dependency (must come first), to=dependent task.
    """
    task_dag.ensure_table()
    return task_dag.get_full_dag(project_id=project)


@router.get("/execution-order")
async def get_execution_order(
    project: Optional[str] = Query(None, description="Filter by project ID"),
):
    """Return active tasks in topological execution order (dependencies first).

    Each entry includes the task row plus DAG metadata (depends_on, ready).
    """
    task_dag.ensure_table()
    ordered_ids = task_dag.topological_sort(project_id=project)
    ready_set = set(task_dag.get_ready_tasks(project_id=project))

    if not ordered_ids:
        return {"tasks": [], "total": 0}

    with _get_connection() as conn:
        placeholders = ",".join("?" * len(ordered_ids))
        rows = conn.execute(
            f"SELECT * FROM tasks WHERE id IN ({placeholders})", ordered_ids
        ).fetchall()

    task_map = {row["id"]: _row_to_task(row) for row in rows}

    # Attach depends_on and ready, preserve topological order
    result = []
    for tid in ordered_ids:
        if tid not in task_map:
            continue
        t = task_map[tid]
        t.depends_on = task_dag.get_dependencies(tid)
        t.ready = tid in ready_set
        result.append(t)

    return {"tasks": result, "total": len(result)}


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str):
    """Get a single task with its children."""
    with _get_connection() as conn:
        cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

        task = _row_to_task(row)

        # Fetch children
        children_cursor = conn.execute(
            "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
            (task_id,),
        )
        task.children = [_row_to_task(r) for r in children_cursor.fetchall()]

    # Attach DAG metadata
    task_dag.ensure_table()
    task.depends_on = task_dag.get_dependencies(task_id)
    task.blocked_by = [
        dep for dep in task.depends_on
        if dep not in {tid for tid in task_dag.get_ready_tasks() if tid == task_id}
    ]
    # blocked_by = deps whose status is not done/verified
    with _get_connection() as conn:
        if task.depends_on:
            placeholders = ",".join("?" * len(task.depends_on))
            unmet = conn.execute(
                f"SELECT id FROM tasks WHERE id IN ({placeholders}) "
                f"AND status NOT IN ('done', 'verified')",
                task.depends_on,
            ).fetchall()
            task.blocked_by = [r["id"] for r in unmet]
        else:
            task.blocked_by = []
    task.ready = len(task.blocked_by) == 0

    return task


@router.post("", response_model=TaskResponse, status_code=201)
async def create_task(body: TaskCreate):
    """Create a new task."""
    if body.priority and body.priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid priority: {body.priority}. Valid: {', '.join(sorted(VALID_PRIORITIES))}",
        )
    if body.source and body.source not in VALID_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source: {body.source}. Valid: {', '.join(sorted(VALID_SOURCES))}",
        )

    with _get_connection() as conn:
        # Validate parent exists if given
        if body.parent_id:
            parent_cursor = conn.execute("SELECT id FROM tasks WHERE id = ?", (body.parent_id,))
            if not parent_cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Parent task not found: {body.parent_id}")

        task_id = _gen_id()
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        status = "assigned" if body.assigned_to else "pending"
        resources_json = json.dumps(body.resources or [])
        tags_json = json.dumps(body.tags or [])

        conn.execute(
            """INSERT INTO tasks (id, title, description, project, assigned_to, status,
               priority, source, parent_id, resources, created_at, updated_at, tags, due_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                task_id,
                body.title,
                body.description or "",
                body.project or "",
                body.assigned_to or "",
                status,
                body.priority or "medium",
                body.source or "system",
                body.parent_id or "",
                resources_json,
                now,
                now,
                tags_json,
                body.due_date or "",
            ),
        )

        # Fetch the created task
        cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        task = _row_to_task(row)
        task.children = []
        return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, update: TaskUpdate):
    """Update a task's status, assigned_to, priority, and/or source."""
    if update.status is not None and update.status not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status: {update.status}. Valid: {', '.join(sorted(VALID_STATUSES))}",
        )
    if update.priority is not None and update.priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid priority: {update.priority}. Valid: {', '.join(sorted(VALID_PRIORITIES))}",
        )
    if update.source is not None and update.source not in VALID_SOURCES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid source: {update.source}. Valid: {', '.join(sorted(VALID_SOURCES))}",
        )

    with _get_connection() as conn:
        # Verify task exists
        cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        updates: list[str] = ["updated_at = ?"]
        params: list = [now]

        if update.status is not None:
            updates.append("status = ?")
            params.append(update.status)
            if update.status in ("done", "verified"):
                updates.append("completed_at = ?")
                params.append(now)
            if update.status in ("done", "verified", "failed"):
                # Compute duration from created_at → now
                created_at_str = row["created_at"]
                if created_at_str:
                    try:
                        created_dt = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                        now_dt = datetime.now(timezone.utc)
                        duration = int((now_dt - created_dt).total_seconds())
                        updates.append("duration_seconds = ?")
                        params.append(duration)
                    except Exception:
                        pass

        if update.assigned_to is not None:
            updates.append("assigned_to = ?")
            params.append(update.assigned_to)
            # Auto-advance from pending to assigned
            current_status = row["status"]
            if current_status == "pending" and update.status is None:
                updates.append("status = ?")
                params.append("assigned")

        if update.priority is not None:
            updates.append("priority = ?")
            params.append(update.priority)

        if update.source is not None:
            updates.append("source = ?")
            params.append(update.source)

        if update.remarks is not None:
            updates.append("remarks = ?")
            params.append(update.remarks)

        if update.tags is not None:
            updates.append("tags = ?")
            params.append(json.dumps(update.tags))

        if update.due_date is not None:
            updates.append("due_date = ?")
            params.append(update.due_date)

        params.append(task_id)
        conn.execute(
            f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?",
            params,
        )

        # Fetch updated task
        cursor = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        updated_row = cursor.fetchone()
        task = _row_to_task(updated_row)

        # Fetch children
        children_cursor = conn.execute(
            "SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at",
            (task_id,),
        )
        task.children = [_row_to_task(r) for r in children_cursor.fetchall()]
        description = updated_row["description"] or ""
        project = updated_row["project"] or ""

    # When transitioning to in-progress, automatically check for blockers
    if update.status == "in-progress":
        try:
            dag_blockers = blocker_detector.check_task_blockers(task_id)
            project_path = blocker_detector._get_project_path(project) if project else None
            code_blockers = blocker_detector.check_code_blockers(
                description, project_path=project_path
            )
            task.blockers = dag_blockers + code_blockers
        except Exception as e:
            logger.warning("Blocker detection failed for %s: %s", task_id, e)
            task.blockers = []

    return task


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    """Delete a task and all its children recursively."""
    with _get_connection() as conn:
        cursor = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

        def _delete_recursive(conn: sqlite3.Connection, parent_id: str) -> int:
            children = conn.execute(
                "SELECT id FROM tasks WHERE parent_id = ?", (parent_id,)
            ).fetchall()
            count = 0
            for child in children:
                count += _delete_recursive(conn, child["id"])
            conn.execute("DELETE FROM tasks WHERE id = ?", (parent_id,))
            return count + 1

        deleted = _delete_recursive(conn, task_id)
        return {"deleted": deleted, "task_id": task_id}


# ── Dependency edges ──────────────────────────────────────────────────────────


@router.post("/{task_id}/depends-on/{dep_id}")
async def add_dependency(task_id: str, dep_id: str):
    """Add a dependency: task_id will wait for dep_id to complete before starting."""
    task_dag.ensure_table()
    try:
        task_dag.add_dependency(task_id, dep_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "task_id": task_id,
        "depends_on": dep_id,
        "added": True,
    }


@router.delete("/{task_id}/depends-on/{dep_id}")
async def remove_dependency(task_id: str, dep_id: str):
    """Remove a dependency edge between two tasks."""
    task_dag.ensure_table()
    removed = task_dag.remove_dependency(task_id, dep_id)
    if not removed:
        raise HTTPException(
            status_code=404,
            detail=f"No dependency edge from {task_id} → {dep_id}",
        )
    return {"task_id": task_id, "depends_on": dep_id, "removed": True}


@router.get("/{task_id}/dependencies")
async def get_dependencies(task_id: str):
    """Get all dependency relationships for a task.

    Returns:
    - depends_on: tasks this task must wait for
    - blocked_by: depends_on tasks that are not yet done
    - dependents: tasks that are waiting for this one
    - ready: whether this task can start now
    """
    with _get_connection() as conn:
        if not conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone():
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")

    task_dag.ensure_table()
    depends_on = task_dag.get_dependencies(task_id)
    dependents = task_dag.get_dependents(task_id)

    # Compute blocked_by: deps not yet done
    blocked_by: list[str] = []
    if depends_on:
        with _get_connection() as conn:
            placeholders = ",".join("?" * len(depends_on))
            unmet = conn.execute(
                f"SELECT id FROM tasks WHERE id IN ({placeholders}) "
                f"AND status NOT IN ('done', 'verified')",
                depends_on,
            ).fetchall()
            blocked_by = [r["id"] for r in unmet]

    return {
        "task_id": task_id,
        "depends_on": depends_on,
        "blocked_by": blocked_by,
        "dependents": dependents,
        "ready": len(blocked_by) == 0,
    }


@router.get("/{task_id}/blockers")
async def get_task_blockers(task_id: str):
    """Run both blocker checks for a single task.

    Returns DAG blockers (unmet dependencies, stuck workers) and code-level
    blockers (missing API endpoints or module files referenced in description).
    """
    with _get_connection() as conn:
        row = conn.execute(
            "SELECT id, description, project FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Task not found: {task_id}")
        description = row["description"] or ""
        project = row["project"] or ""

    dag_blockers = blocker_detector.check_task_blockers(task_id)

    project_path = blocker_detector._get_project_path(project) if project else None
    code_blockers = blocker_detector.check_code_blockers(
        description, project_path=project_path
    )

    all_blockers = dag_blockers + code_blockers
    return {
        "task_id": task_id,
        "blockers": all_blockers,
        "total": len(all_blockers),
        "dag_blockers": len(dag_blockers),
        "code_blockers": len(code_blockers),
    }
