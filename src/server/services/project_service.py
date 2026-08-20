"""Project registry service — SQLite master, JSON view.

The registry MASTER is the `projects` table in the consolidated SQLite DB
(.soren/soren.db, resolved via services/db.py). .soren/projects.json is a
REGENERATED READ-ONLY VIEW of that table so existing jq readers (monitor.sh,
verify-done.sh, tools/workers, scan-project.sh, memory-index, soren-init,
soren-run, blocker_detector.py, ...) keep working unchanged.

This replaces the old fcntl-locked JSON read-modify-write: sqlite
(busy_timeout=5000) is the write serializer shared with the bash tool
(tools/projects), and the view is regenerated post-commit via tmp+rename.

View byte format: json.dumps({"projects": [...]}, indent=2, ensure_ascii=False)
+ "\n" — byte-identical to the bash regeneration (`jq .` formatting) for the
same table state. Boolean columns are JSON booleans in the view; an empty
supervisor_agent_id renders as null (both legacy writers emitted null).

NOTE (shared schema + view shape): duplicated in tools/projects — keep in sync.
"""

import json
import logging
import os
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..config import settings
from ..models.project import Project
from .db import get_db

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id                  TEXT PRIMARY KEY,
    name                TEXT,
    path                TEXT,
    is_self             INTEGER DEFAULT 0,
    active              INTEGER DEFAULT 1,
    supervisor_agent_id TEXT DEFAULT '',
    hooks_installed     INTEGER DEFAULT 0,
    added_at            TEXT,
    git_remote          TEXT DEFAULT '',
    language            TEXT DEFAULT '',
    description         TEXT DEFAULT ''
)
"""

_BOOL_FIELDS = ("is_self", "active", "hooks_installed")

_COLUMNS = (
    "id", "name", "path", "is_self", "active", "supervisor_agent_id",
    "hooks_installed", "added_at", "git_remote", "language", "description",
)


class ProjectService:
    """Service for the SOREN project registry (sqlite master + JSON view)."""

    def __init__(self, projects_file: Optional[Path] = None, db_path: Optional[Path] = None):
        # projects_file overrides the VIEW path (tests); db_path overrides the
        # master DB path (tests) — default follows settings dynamically.
        self._file_override = projects_file
        self._db_override = db_path

    # ── plumbing ──────────────────────────────────────────────────────────────

    @property
    def _view_path(self) -> Path:
        if self._file_override is not None:
            return self._file_override
        return Path(settings.soren_dir) / "projects.json"

    def _db(self):
        return get_db(self._db_override)

    def _init(self, conn: sqlite3.Connection) -> None:
        """Ensure schema + one-time lazy import from a legacy projects.json."""
        conn.execute(SCHEMA)
        self._import_legacy(conn)

    def _import_legacy(self, conn: sqlite3.Connection) -> None:
        """If the table is empty but a populated projects.json exists, seed the
        table from it. The file is NOT renamed — it becomes the regenerated
        view. Mirrors the bash import in tools/projects."""
        count = conn.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        if count > 0:
            return
        view = self._view_path
        if not view.exists():
            return
        try:
            data = json.loads(view.read_text())
        except (json.JSONDecodeError, OSError):
            return
        entries = data.get("projects", []) if isinstance(data, dict) else []
        entries = [p for p in entries if isinstance(p, dict) and p.get("id")]
        if not entries:
            return
        for p in entries:
            conn.execute(
                "INSERT OR IGNORE INTO projects "
                "(id, name, path, is_self, active, supervisor_agent_id, "
                " hooks_installed, added_at, git_remote, language, description) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    p.get("id"),
                    p.get("name") or "",
                    p.get("path") or "",
                    1 if p.get("is_self") else 0,
                    1 if p.get("active") else 0,
                    p.get("supervisor_agent_id") or "",
                    1 if p.get("hooks_installed") else 0,
                    p.get("added_at") or "",
                    p.get("git_remote") or "",
                    p.get("language") or "",
                    p.get("description") or "",
                ),
            )
        conn.commit()
        logger.info(
            "Imported %d project(s) from legacy %s into sqlite (file kept as view)",
            len(entries), view,
        )
        # Canonicalize the file now that it is a derived view
        self._regenerate_view(conn)

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> Dict[str, Any]:
        """Table row → legacy view/API shape (INTEGER↔boolean at the boundary,
        '' supervisor_agent_id → null). Key order matches the bash view SQL."""
        sid = row["supervisor_agent_id"]
        return {
            "id": row["id"],
            "name": row["name"],
            "path": row["path"],
            "is_self": bool(row["is_self"]),
            "active": bool(row["active"]),
            "supervisor_agent_id": sid if sid else None,
            "hooks_installed": bool(row["hooks_installed"]),
            "added_at": row["added_at"],
            "git_remote": row["git_remote"] if row["git_remote"] is not None else "",
            "language": row["language"] if row["language"] is not None else "",
            "description": row["description"] if row["description"] is not None else "",
        }

    def _read_entries(self, conn: sqlite3.Connection) -> List[Dict[str, Any]]:
        rows = conn.execute("SELECT * FROM projects ORDER BY rowid").fetchall()
        return [self._row_to_entry(r) for r in rows]

    def _regenerate_view(self, conn: sqlite3.Connection) -> None:
        """Regenerate the read-only JSON view (call AFTER commit). tmp+rename
        in the same directory = atomic same-filesystem replacement."""
        try:
            entries = self._read_entries(conn)
            view = self._view_path
            view.parent.mkdir(parents=True, exist_ok=True)
            tmp = view.with_name(f"{view.name}.tmp.{os.getpid()}")
            tmp.write_text(
                json.dumps({"projects": entries}, indent=2, ensure_ascii=False) + "\n"
            )
            tmp.rename(view)
        except OSError as e:
            logger.warning("projects.json view regeneration failed: %s", e)

    # ── public API ────────────────────────────────────────────────────────────

    def list_projects(self) -> List[Project]:
        """List all registered projects."""
        with self._db() as conn:
            self._init(conn)
            return [Project(**e) for e in self._read_entries(conn)]

    def get_project(self, project_id: str) -> Optional[Project]:
        """Get a single project by ID."""
        with self._db() as conn:
            self._init(conn)
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return Project(**self._row_to_entry(row)) if row else None

    def add_project(self, path: str, name: Optional[str] = None, description: Optional[str] = None) -> Project:
        """Register a new project.

        Derives ID from directory basename, auto-detects git remote and language.
        """
        resolved = Path(path).resolve()
        if not resolved.is_dir():
            raise ValueError(f"Directory does not exist: {path}")

        project_id = resolved.name.lower().replace(" ", "-").replace(".", "-")
        project_id = "".join(c for c in project_id if c.isalnum() or c == "-")
        if not project_id:
            raise ValueError(f"Could not derive project ID from path: {path}")

        git_remote = self._detect_git_remote(str(resolved))
        language = self._detect_language(str(resolved))
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        with self._db() as conn:
            self._init(conn)
            exists = conn.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if exists:
                raise ValueError(f"Project '{project_id}' already registered")
            conn.execute(
                "INSERT INTO projects "
                "(id, name, path, is_self, active, supervisor_agent_id, "
                " hooks_installed, added_at, git_remote, language, description) "
                "VALUES (?,?,?,0,0,'',0,?,?,?,?)",
                (
                    project_id,
                    name or resolved.name,
                    str(resolved),
                    now,
                    git_remote or "",
                    language,
                    description or "",
                ),
            )
            conn.commit()
            self._regenerate_view(conn)
            row = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return Project(**self._row_to_entry(row))

    def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Project]:
        """Update project metadata. Only updates provided (non-None) fields."""
        sets, params = [], []
        for key, value in updates.items():
            if value is None or key not in _COLUMNS or key == "id":
                continue
            if key in _BOOL_FIELDS:
                value = 1 if value else 0
            sets.append(f"{key} = ?")
            params.append(value)

        with self._db() as conn:
            self._init(conn)
            row = conn.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not row:
                return None
            if sets:
                conn.execute(
                    f"UPDATE projects SET {', '.join(sets)} WHERE id = ?",
                    (*params, project_id),
                )
                conn.commit()
                self._regenerate_view(conn)
            updated = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return Project(**self._row_to_entry(updated))

    def remove_project(self, project_id: str) -> bool:
        """Remove a project from the registry. Returns True if found and removed."""
        with self._db() as conn:
            self._init(conn)
            row = conn.execute(
                "SELECT is_self FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not row:
                return False
            if row["is_self"]:
                raise ValueError("Cannot remove SOREN self-project")
            conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            conn.commit()
            self._regenerate_view(conn)
            return True

    def set_active(self, project_id: str, active: bool, supervisor_agent_id: Optional[str] = None) -> Optional[Project]:
        """Set a project's active state and optionally its supervisor_agent_id."""
        with self._db() as conn:
            self._init(conn)
            row = conn.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if not row:
                return None
            if supervisor_agent_id is not None:
                conn.execute(
                    "UPDATE projects SET active = ?, supervisor_agent_id = ? WHERE id = ?",
                    (1 if active else 0, supervisor_agent_id, project_id),
                )
            elif not active:
                conn.execute(
                    "UPDATE projects SET active = 0, supervisor_agent_id = '' WHERE id = ?",
                    (project_id,),
                )
            else:
                conn.execute(
                    "UPDATE projects SET active = 1 WHERE id = ?", (project_id,)
                )
            conn.commit()
            self._regenerate_view(conn)
            updated = conn.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return Project(**self._row_to_entry(updated))

    def get_project_agents(self, project_id: str) -> List[Dict[str, Any]]:
        """Get agents associated with a project from the agent registry."""
        from .agent_registry import agent_registry

        all_entries = agent_registry.get_all_entries()
        agents = []
        for key, entry in all_entries.items():
            if entry.get("project_id") == project_id:
                agents.append({"key": key, **entry})
        return agents

    @staticmethod
    def _detect_git_remote(directory: str) -> str:
        """Detect the git origin remote URL."""
        try:
            result = subprocess.run(
                ["git", "-C", directory, "remote", "get-url", "origin"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except (subprocess.TimeoutExpired, FileNotFoundError):
            return ""

    @staticmethod
    def _detect_language(directory: str) -> str:
        """Detect the primary language from project files."""
        d = Path(directory)
        if (d / "pyproject.toml").exists() or (d / "setup.py").exists():
            return "python"
        if (d / "package.json").exists():
            return "javascript"
        if (d / "Cargo.toml").exists():
            return "rust"
        if (d / "go.mod").exists():
            return "go"
        if (d / "pom.xml").exists() or (d / "build.gradle").exists():
            return "java"
        if (d / "Gemfile").exists():
            return "ruby"
        return "unknown"


project_service = ProjectService()
