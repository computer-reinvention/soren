"""Proactive blocker detection — find dependency gaps before workers hit them.

Level 1: DAG-based — checks whether task dependencies are actually done and
         whether the assigned workers are stuck (blocked/failed status).

Level 2: Code-level — scans task descriptions for API endpoint and module
         references, then verifies those artifacts exist in the codebase.
"""

import json
import logging
import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from ..config import settings
from .task_dag import DB_PATH as TASKS_DB_PATH, get_dependencies

logger = logging.getLogger(__name__)

# ── Regex patterns for code-level detection ────────────────────────────────────

# /api/foo or /api/foo/bar — API endpoint references in task descriptions
_API_RE = re.compile(r'/api/([\w\-]+(?:/[\w\-]+)*)')

# services.foo, routes.foo, models.foo — explicit module path references
_MODULE_REF_RE = re.compile(r'\b(?:services|routes|models)\.([\w]+)')

# "from services import X" or "import services.X" in description text
_IMPORT_RE = re.compile(
    r'(?:from\s+(?:src\.server\.)?(?:services|routes|models)\.(\w+)\s+import'
    r'|import\s+(?:src\.server\.)?(?:services|routes|models)\.(\w+))'
)


# ── DB helper ──────────────────────────────────────────────────────────────────

@contextmanager
def _task_conn():
    if not TASKS_DB_PATH.exists():
        raise RuntimeError("tasks.db not found")
    conn = sqlite3.connect(str(TASKS_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        yield conn
    finally:
        conn.close()


def _get_project_path(project_id: str) -> Optional[str]:
    """Look up a project's filesystem path from projects.json."""
    projects_file = settings.soren_dir / "projects.json"
    if not projects_file.exists():
        return None
    try:
        data = json.loads(projects_file.read_text())
        for p in data.get("projects", []):
            if p.get("id") == project_id:
                return p.get("path")
    except (json.JSONDecodeError, OSError):
        pass
    return None


# ── Level 1: DAG-based blocker detection ──────────────────────────────────────

def check_task_blockers(task_id: str) -> list[dict]:
    """Check DAG dependencies for a task — are all deps done, and are any stuck?

    Returns a list of blocker dicts:
    {type, dep_task_id, dep_title, dep_status, assigned_to, severity, message}
    """
    deps = get_dependencies(task_id)
    if not deps:
        return []

    blockers: list[dict] = []

    try:
        with _task_conn() as conn:
            for dep_id in deps:
                row = conn.execute(
                    "SELECT id, title, status, assigned_to FROM tasks WHERE id = ?",
                    (dep_id,),
                ).fetchone()

                if not row:
                    blockers.append({
                        "type": "missing_dependency",
                        "dep_task_id": dep_id,
                        "dep_title": "",
                        "dep_status": "unknown",
                        "assigned_to": "",
                        "severity": "critical",
                        "message": f"Dependency task {dep_id} no longer exists in the database",
                    })
                    continue

                dep_status = row["status"]
                if dep_status in ("done", "verified"):
                    continue  # satisfied — not a blocker

                assigned_to = row["assigned_to"] or ""
                dep_title = row["title"] or dep_id

                if dep_status in ("blocked", "failed"):
                    severity = "critical"
                    msg = (
                        f"Dependency '{dep_title}' is {dep_status}"
                        + (f" (assigned to {assigned_to})" if assigned_to else " (unassigned)")
                        + " — will not unblock automatically"
                    )
                elif dep_status == "pending" and not assigned_to:
                    severity = "warning"
                    msg = f"Dependency '{dep_title}' is unassigned and pending — nobody is working on it"
                else:
                    severity = "info"
                    msg = (
                        f"Dependency '{dep_title}' is still '{dep_status}'"
                        + (f" (assigned to {assigned_to})" if assigned_to else " (unassigned)")
                    )

                blockers.append({
                    "type": "unmet_dependency",
                    "dep_task_id": dep_id,
                    "dep_title": dep_title,
                    "dep_status": dep_status,
                    "assigned_to": assigned_to,
                    "severity": severity,
                    "message": msg,
                })
    except RuntimeError:
        pass  # DB not yet created

    return blockers


# ── Level 2: Code-level blocker detection ─────────────────────────────────────

def check_code_blockers(
    task_description: str,
    project_path: Optional[str] = None,
) -> list[dict]:
    """Scan a task description for API/module references and verify they exist.

    Checks:
    - /api/<path> references → looks for matching route registration
    - services.X / routes.X / models.X → looks for the module file
    - "from services.X import" / "import routes.X" patterns

    Returns list of {type, reference, expected_path, message}.
    """
    base = Path(project_path) if project_path else settings.soren_dir.parent
    src = base / "src" / "server"

    if not src.exists():
        return []  # Not a Python backend project

    blockers: list[dict] = []
    already_flagged: set[str] = set()

    # --- API endpoint references ---
    for m in _API_RE.finditer(task_description):
        full_path = m.group(0)          # e.g. /api/memory/search
        first_segment = m.group(1).split("/")[0]  # e.g. "memory"

        if first_segment in already_flagged:
            continue

        routes_dir = src / "routes"
        main_py = src / "main.py"
        found = False

        # Check route files for the segment as a path or variable name
        segment_pattern = re.compile(
            rf'(?:["\'/]{re.escape(first_segment)}["\'/]'
            rf'|prefix\s*=\s*["\']/?api/{re.escape(first_segment)})',
        )
        if routes_dir.exists():
            for rf in routes_dir.glob("*.py"):
                try:
                    if segment_pattern.search(rf.read_text(errors="replace")):
                        found = True
                        break
                except OSError:
                    pass

        # Also check main.py router registration
        if not found and main_py.exists():
            try:
                if f'"{first_segment}"' in main_py.read_text(errors="replace"):
                    found = True
            except OSError:
                pass

        if not found:
            already_flagged.add(first_segment)
            blockers.append({
                "type": "missing_code",
                "reference": full_path,
                "expected_path": f"src/server/routes/{first_segment}.py",
                "message": (
                    f"API endpoint {full_path} referenced in task description "
                    f"but no route for '{first_segment}' found in routes/ or main.py"
                ),
            })

    # --- Module references: services.X, routes.X, models.X ---
    module_refs: set[str] = set()
    for m in _MODULE_REF_RE.finditer(task_description):
        module_refs.add(m.group(1))
    for m in _IMPORT_RE.finditer(task_description):
        name = m.group(1) or m.group(2)
        if name:
            module_refs.add(name)

    for module_name in module_refs:
        if module_name in already_flagged:
            continue
        candidates = [
            src / "services" / f"{module_name}.py",
            src / "routes" / f"{module_name}.py",
            src / "models" / f"{module_name}.py",
        ]
        if not any(p.exists() for p in candidates):
            already_flagged.add(module_name)
            blockers.append({
                "type": "missing_code",
                "reference": module_name,
                "expected_path": f"src/server/services/{module_name}.py",
                "message": (
                    f"Module '{module_name}' referenced in task description "
                    f"but not found in services/, routes/, or models/"
                ),
            })

    return blockers


# ── Full system scan ──────────────────────────────────────────────────────────

def scan_all_active_tasks(project_id: Optional[str] = None) -> dict:
    """Run both blocker checks across all active (in-progress/assigned/review) tasks.

    Returns:
    {
      blockers: [list of blocker dicts with task_id, task_title, worker added],
      summary: {total_blockers, tasks_scanned, by_type, by_worker}
    }
    """
    try:
        with _task_conn() as conn:
            params: list = []
            where = "status IN ('in-progress', 'assigned', 'review', 'blocked')"
            if project_id:
                where += " AND project = ?"
                params.append(project_id)

            rows = conn.execute(
                f"SELECT id, title, description, assigned_to, status, project "
                f"FROM tasks WHERE {where}",
                params,
            ).fetchall()
    except RuntimeError:
        return {"blockers": [], "summary": {"total_blockers": 0, "tasks_scanned": 0,
                                            "by_type": {}, "by_worker": {}}}

    all_blockers: list[dict] = []
    by_type: dict[str, int] = {}
    by_worker: dict[str, int] = {}

    for row in rows:
        task_id = row["id"]
        worker = row["assigned_to"] or ""
        project = row["project"] or ""

        # Level 1: DAG blockers
        dag_blockers = check_task_blockers(task_id)

        # Level 2: Code-level blockers
        description = row["description"] or ""
        project_path = _get_project_path(project) if project else None
        code_blockers = check_code_blockers(description, project_path=project_path)

        for b in dag_blockers + code_blockers:
            enriched = dict(b)
            enriched["task_id"] = task_id
            enriched["task_title"] = row["title"]
            enriched["task_status"] = row["status"]
            enriched["worker"] = worker
            all_blockers.append(enriched)

            btype = b["type"]
            by_type[btype] = by_type.get(btype, 0) + 1

            if worker:
                by_worker[worker] = by_worker.get(worker, 0) + 1

    return {
        "blockers": all_blockers,
        "summary": {
            "total_blockers": len(all_blockers),
            "tasks_scanned": len(rows),
            "by_type": by_type,
            "by_worker": by_worker,
        },
    }
