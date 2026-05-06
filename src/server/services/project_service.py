import fcntl
import json
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from ..models.project import Project

PROJECTS_FILE = Path(".soren/projects.json")


class ProjectService:
    """Service for managing the SOREN project registry (.soren/projects.json)."""

    def __init__(self, projects_file: Optional[Path] = None):
        self._file = projects_file or PROJECTS_FILE

    def _ensure_file(self):
        """Ensure the projects.json file exists."""
        if not self._file.exists():
            self._file.parent.mkdir(parents=True, exist_ok=True)
            self._file.write_text('{"projects": []}')

    def _read(self) -> List[Dict[str, Any]]:
        """Read projects from disk with shared lock."""
        self._ensure_file()
        try:
            with open(self._file, "r") as f:
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                data = json.load(f)
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                return data.get("projects", [])
        except (json.JSONDecodeError, IOError):
            return []

    def _write(self, projects: List[Dict[str, Any]]):
        """Write projects to disk with exclusive lock."""
        self._ensure_file()
        with open(self._file, "w") as f:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            json.dump({"projects": projects}, f, indent=2)
            f.flush()
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)

    def list_projects(self) -> List[Project]:
        """List all registered projects."""
        raw = self._read()
        return [Project(**p) for p in raw]

    def get_project(self, project_id: str) -> Optional[Project]:
        """Get a single project by ID."""
        for p in self._read():
            if p.get("id") == project_id:
                return Project(**p)
        return None

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

        projects = self._read()
        for p in projects:
            if p.get("id") == project_id:
                raise ValueError(f"Project '{project_id}' already registered")

        git_remote = self._detect_git_remote(str(resolved))
        language = self._detect_language(str(resolved))
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        entry = {
            "id": project_id,
            "name": name or resolved.name,
            "path": str(resolved),
            "is_self": False,
            "active": False,
            "supervisor_agent_id": None,
            "hooks_installed": False,
            "added_at": now,
            "git_remote": git_remote or None,
            "language": language,
            "description": description or None,
        }

        projects.append(entry)
        self._write(projects)
        return Project(**entry)

    def update_project(self, project_id: str, updates: Dict[str, Any]) -> Optional[Project]:
        """Update project metadata. Only updates provided (non-None) fields."""
        projects = self._read()
        for i, p in enumerate(projects):
            if p.get("id") == project_id:
                for key, value in updates.items():
                    if value is not None:
                        p[key] = value
                projects[i] = p
                self._write(projects)
                return Project(**p)
        return None

    def remove_project(self, project_id: str) -> bool:
        """Remove a project from the registry. Returns True if found and removed."""
        projects = self._read()
        for p in projects:
            if p.get("id") == project_id:
                if p.get("is_self"):
                    raise ValueError("Cannot remove SOREN self-project")
                projects = [proj for proj in projects if proj.get("id") != project_id]
                self._write(projects)
                return True
        return False

    def set_active(self, project_id: str, active: bool, supervisor_agent_id: Optional[str] = None) -> Optional[Project]:
        """Set a project's active state and optionally its supervisor_agent_id."""
        projects = self._read()
        for i, p in enumerate(projects):
            if p.get("id") == project_id:
                p["active"] = active
                if supervisor_agent_id is not None:
                    p["supervisor_agent_id"] = supervisor_agent_id
                elif not active:
                    p["supervisor_agent_id"] = None
                projects[i] = p
                self._write(projects)
                return Project(**p)
        return None

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
