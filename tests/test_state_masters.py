"""Tests for the projects/teams/schedule/prefs file→table migrations.

Covers the four state domains converted from racy JSON-file storage to tables
in the consolidated DB (.soren/soren.db):

1. projects — sqlite master + regenerated .soren/projects.json view
   (tools/projects + services/project_service.py + routes/projects.py)
2. teams    — sqlite master + regenerated .soren/teams.json view
   (tools/teams + routes/teams.py)
3. schedule — table only; atomic UPDATE...RETURNING fire (tools/schedule)
4. prefs    — merged kv table (tools/prefs + routes/prefs.py)

Bash-driven tests sandbox everything via SOREN_HOME/SOREN_DB pointing at a tmp
dir (tmux/curl stubbed on PATH); the live .soren/ is never touched. View
byte-parity between the bash regenerators (`jq .`) and the python regenerators
(json.dumps(indent=2, ensure_ascii=False) + '\\n') is asserted directly.
"""

import json
import os
import sqlite3
import subprocess
from pathlib import Path

import pytest

from src.server.config import settings
from src.server.services.db import get_db
from src.server.services.project_service import ProjectService

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PROJECTS_TOOL = PROJECT_ROOT / "tools" / "projects"
TEAMS_TOOL = PROJECT_ROOT / "tools" / "teams"
SCHEDULE_TOOL = PROJECT_ROOT / "tools" / "schedule"
PREFS_TOOL = PROJECT_ROOT / "tools" / "prefs"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _query(db_path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    conn = sqlite3.connect(str(db_path), timeout=10)
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _exec(db_path: Path, sql: str, params: tuple = ()) -> None:
    conn = sqlite3.connect(str(db_path), timeout=10)
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def sandbox(tmp_path):
    """An isolated fake SOREN root for the bash tools.

    Layout:
        <root>/tools/{lib,projects,teams,schedule,prefs} — symlinks to the real ones
        <root>/bin/{tmux,curl} — stubs (activate/deactivate never touch real tmux)
        <root>/.soren/         — runtime dir (soren.db, views, ...)
    """
    root = tmp_path / "sbx"
    (root / ".soren").mkdir(parents=True)
    tools = root / "tools"
    tools.mkdir()
    (tools / "lib").symlink_to(PROJECT_ROOT / "tools" / "lib")
    for t in ("projects", "teams", "schedule", "prefs"):
        (tools / t).symlink_to(PROJECT_ROOT / "tools" / t)

    bin_dir = root / "bin"
    bin_dir.mkdir()
    tmux_stub = bin_dir / "tmux"
    tmux_stub.write_text(
        "#!/usr/bin/env bash\n"
        'case "${1:-}" in\n'
        "    has-session) exit 1 ;;\n"
        "    list-windows) exit 0 ;;\n"
        "    *) exit 0 ;;\n"
        "esac\n"
    )
    tmux_stub.chmod(0o755)
    curl_stub = bin_dir / "curl"
    curl_stub.write_text("#!/usr/bin/env bash\nexit 0\n")
    curl_stub.chmod(0o755)

    return root


def _env(root: Path) -> dict:
    return {
        **os.environ,
        "SOREN_HOME": str(root),
        "SOREN_DB": str(root / ".soren" / "soren.db"),
        "SOREN_SESSION": f"soren-sbx-{os.getpid()}",  # nonexistent session
        "SOREN_AGENT_NAME": "test-agent",
        "PATH": f"{root / 'bin'}:{os.environ['PATH']}",
    }


def _run(tool: Path, *args, root: Path, check: bool = True) -> subprocess.CompletedProcess:
    out = subprocess.run(
        ["bash", str(tool), *args],
        capture_output=True, text=True, cwd=root, env=_env(root), timeout=120,
    )
    if check:
        assert out.returncode == 0, f"{tool.name} {args} failed:\n{out.stdout}\n{out.stderr}"
    return out


def _sandbox_db(root: Path) -> Path:
    return root / ".soren" / "soren.db"


def _py_dumps_view(key: str, entries: list) -> bytes:
    """The python-side view byte contract."""
    return (json.dumps({key: entries}, indent=2, ensure_ascii=False) + "\n").encode()


# ─────────────────────────────────────────────────────────────────────────────
# 1a. Projects — API CRUD writes the table and regenerates the view
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def projects_view(tmp_path, monkeypatch):
    """Point the global project_service at a tmp view file (DB already goes to
    the tmp consolidated DB via conftest)."""
    view = tmp_path / "projects-view.json"
    svc = ProjectService(projects_file=view)
    from src.server.services import project_service as ps_module
    from src.server.routes import projects as projects_route
    monkeypatch.setattr(ps_module, "project_service", svc)
    monkeypatch.setattr(projects_route, "project_service", svc)
    return view


class TestProjectsApiAndView:
    def test_crud_regenerates_view_with_booleans(self, client, projects_view, tmp_path):
        proj_dir = tmp_path / "view-proj"
        proj_dir.mkdir()
        (proj_dir / "pyproject.toml").write_text("")

        # CREATE
        r = client.post("/api/projects", json={
            "path": str(proj_dir), "name": "View Proj", "description": "ünïcode ✓",
        })
        assert r.status_code == 201

        raw = projects_view.read_text()
        assert raw.endswith("\n")
        # Booleans must be real JSON booleans in the view (not 0/1)
        assert '"is_self": false' in raw
        assert '"active": false' in raw
        assert '"hooks_installed": false' in raw
        assert '"supervisor_agent_id": null' in raw
        # ensure_ascii=False: multi-byte chars stay raw
        assert "ünïcode ✓" in raw

        data = json.loads(raw)
        assert list(data.keys()) == ["projects"]
        entry = data["projects"][0]
        assert entry["id"] == "view-proj"
        assert entry["is_self"] is False and entry["active"] is False
        assert entry["language"] == "python"
        # Legacy key order preserved
        assert list(entry.keys()) == [
            "id", "name", "path", "is_self", "active", "supervisor_agent_id",
            "hooks_installed", "added_at", "git_remote", "language", "description",
        ]

        # Row landed in the consolidated DB (booleans stored as INTEGER)
        rows = _query(Path(settings.db_path),
                      "SELECT is_self, active, hooks_installed FROM projects WHERE id='view-proj'")
        assert rows == [(0, 0, 0)]

        # UPDATE
        r = client.patch("/api/projects/view-proj", json={"description": "updated"})
        assert r.status_code == 200
        assert json.loads(projects_view.read_text())["projects"][0]["description"] == "updated"

        # DELETE
        r = client.delete("/api/projects/view-proj")
        assert r.status_code == 200
        assert json.loads(projects_view.read_text()) == {"projects": []}

    def test_set_active_view_boolean_and_null_roundtrip(self, client, projects_view, tmp_path):
        from src.server.routes.projects import project_service as svc
        proj_dir = tmp_path / "act-proj"
        proj_dir.mkdir()
        client.post("/api/projects", json={"path": str(proj_dir)})

        svc.set_active("act-proj", True, supervisor_agent_id="ag_view0001")
        entry = json.loads(projects_view.read_text())["projects"][0]
        assert entry["active"] is True
        assert entry["supervisor_agent_id"] == "ag_view0001"

        svc.set_active("act-proj", False)
        entry = json.loads(projects_view.read_text())["projects"][0]
        assert entry["active"] is False
        assert entry["supervisor_agent_id"] is None  # '' in the master → null in the view

    def test_lazy_import_keeps_file_as_view(self, projects_view):
        legacy = {
            "projects": [{
                "id": "legacy-proj", "name": "Legacy", "path": "/tmp/legacy",
                "is_self": False, "active": True, "supervisor_agent_id": None,
                "hooks_installed": True, "added_at": "2026-01-01T00:00:00Z",
                "git_remote": None, "language": "python", "description": None,
            }]
        }
        projects_view.write_text(json.dumps(legacy))

        svc = ProjectService(projects_file=projects_view)
        projects = svc.list_projects()
        assert [p.id for p in projects] == ["legacy-proj"]
        assert projects[0].hooks_installed is True

        # File kept (it is the view now) and canonicalized
        data = json.loads(projects_view.read_text())
        entry = data["projects"][0]
        assert entry["active"] is True
        assert entry["supervisor_agent_id"] is None
        assert entry["git_remote"] == ""  # None normalized to '' at the boundary

        # Table populated; no re-import duplication on subsequent reads
        assert len(svc.list_projects()) == 1
        rows = _query(Path(settings.db_path), "SELECT id FROM projects")
        assert rows == [("legacy-proj",)]


# ─────────────────────────────────────────────────────────────────────────────
# 1b. Projects — bash full cycle in a sandbox: table + view at every step,
#     byte-parity with the python regenerator, external jq reader expressions
# ─────────────────────────────────────────────────────────────────────────────

class TestProjectsBashCycle:
    def _view(self, root: Path) -> Path:
        return root / ".soren" / "projects.json"

    def _assert_python_parity(self, root: Path):
        """Regenerating the view from python must reproduce the bash bytes."""
        view = self._view(root)
        bash_bytes = view.read_bytes()
        svc = ProjectService(projects_file=view, db_path=_sandbox_db(root))
        with svc._db() as conn:
            svc._init(conn)
            svc._regenerate_view(conn)
        assert view.read_bytes() == bash_bytes, "bash and python view bytes differ"

    def _jq(self, root: Path, *args) -> str:
        out = subprocess.run(
            ["jq", *args, str(self._view(root))],
            capture_output=True, text=True, timeout=30,
        )
        assert out.returncode == 0, out.stderr
        return out.stdout.strip()

    def test_full_cycle_add_activate_deactivate_remove(self, sandbox, tmp_path):
        db = _sandbox_db(sandbox)
        proj = tmp_path / "cycle-proj"
        proj.mkdir()
        (proj / "pyproject.toml").write_text("")

        # ── add ──
        _run(PROJECTS_TOOL, "add", str(proj), "--description", "it's a tëst", root=sandbox)
        rows = _query(db, "SELECT id, is_self, active, hooks_installed, description FROM projects")
        assert rows == [("cycle-proj", 0, 0, 0, "it's a tëst")]
        view = json.loads(self._view(sandbox).read_text())
        assert view["projects"][0]["active"] is False
        assert view["projects"][0]["description"] == "it's a tëst"
        self._assert_python_parity(sandbox)

        # External jq readers (exact expressions from their source files)
        # monitor.sh:355 / autonomy-check:298 — active non-self project ids
        assert self._jq(
            sandbox, "-r",
            '.projects[] | select(.active == true and .is_self == false) | .id',
        ) == ""
        # verify-done.sh:45 — path lookup by id
        assert self._jq(
            sandbox, "-r", "--arg", "id", "cycle-proj",
            '.projects[] | select(.id == $id) | .path // empty',
        ) == str(proj)
        # tools/workers:249 / scan-project.sh:24 — path by project id
        assert self._jq(
            sandbox, "-r", "--arg", "pid", "cycle-proj",
            '.projects[] | select(.id == $pid) | .path // empty',
        ) == str(proj)

        # ── install-hooks (boolean write site) ──
        _run(PROJECTS_TOOL, "install-hooks", "cycle-proj", root=sandbox)
        assert _query(db, "SELECT hooks_installed FROM projects") == [(1,)]
        assert json.loads(self._view(sandbox).read_text())["projects"][0]["hooks_installed"] is True

        # ── activate (tmux/curl stubbed) ──
        _run(PROJECTS_TOOL, "activate", "cycle-proj", root=sandbox)
        rows = _query(db, "SELECT active, supervisor_agent_id FROM projects")
        assert rows[0][0] == 1
        agent_id = rows[0][1]
        assert agent_id.startswith("ag_") and len(agent_id) == 11
        view = json.loads(self._view(sandbox).read_text())
        assert view["projects"][0]["active"] is True
        assert view["projects"][0]["supervisor_agent_id"] == agent_id
        self._assert_python_parity(sandbox)

        # monitor.sh's active-project scan now finds it
        assert self._jq(
            sandbox, "-r",
            '.projects[] | select(.active == true and .is_self == false) | .id',
        ) == "cycle-proj"

        # ── deactivate ──
        _run(PROJECTS_TOOL, "deactivate", "cycle-proj", root=sandbox)
        assert _query(db, "SELECT active, supervisor_agent_id FROM projects") == [(0, "")]
        view = json.loads(self._view(sandbox).read_text())
        assert view["projects"][0]["active"] is False
        assert view["projects"][0]["supervisor_agent_id"] is None
        self._assert_python_parity(sandbox)

        # ── remove ──
        _run(PROJECTS_TOOL, "remove", "cycle-proj", root=sandbox)
        assert _query(db, "SELECT COUNT(*) FROM projects") == [(0,)]
        assert json.loads(self._view(sandbox).read_text()) == {"projects": []}
        self._assert_python_parity(sandbox)

    def test_bash_lazy_import_from_legacy_file(self, sandbox):
        db = _sandbox_db(sandbox)
        legacy = {
            "projects": [{
                "id": "old-proj", "name": "Old", "path": "/tmp/old",
                "is_self": False, "active": False, "supervisor_agent_id": None,
                "hooks_installed": False, "added_at": "2026-01-01T00:00:00Z",
                "git_remote": "", "language": "go", "description": "",
            }]
        }
        self._view(sandbox).write_text(json.dumps(legacy))

        out = _run(PROJECTS_TOOL, "list", root=sandbox)
        assert "old-proj" in out.stdout
        assert _query(db, "SELECT id, language FROM projects") == [("old-proj", "go")]
        # File kept as the (canonicalized) view
        data = json.loads(self._view(sandbox).read_text())
        assert data["projects"][0]["id"] == "old-proj"
        self._assert_python_parity(sandbox)

    def test_self_project_guard(self, sandbox):
        db = _sandbox_db(sandbox)
        _run(PROJECTS_TOOL, "list", root=sandbox)  # init schema + view
        _exec(db,
              "INSERT INTO projects (id, name, path, is_self, active, supervisor_agent_id, "
              "hooks_installed, added_at, git_remote, language, description) "
              "VALUES ('soren','SOREN','/tmp/soren',1,1,'',0,'2026-01-01T00:00:00Z','','python','')")
        out = _run(PROJECTS_TOOL, "remove", "soren", root=sandbox, check=False)
        assert out.returncode != 0
        assert "cannot remove SOREN self-project" in out.stderr
        out = _run(PROJECTS_TOOL, "deactivate", "soren", root=sandbox, check=False)
        assert out.returncode != 0
        assert "cannot deactivate SOREN self-project" in out.stderr


# ─────────────────────────────────────────────────────────────────────────────
# 2. Teams — route reads the table; bash records/removes; view parity
# ─────────────────────────────────────────────────────────────────────────────

class TestTeamsTable:
    def test_route_reads_table_not_file(self, client):
        # Seed the table directly — no teams.json anywhere
        with get_db() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS teams (prefix TEXT PRIMARY KEY, template TEXT, "
                "task TEXT, project_id TEXT, created_at TEXT, members TEXT DEFAULT '[]', "
                "permanent INTEGER DEFAULT 0)"
            )
            conn.execute(
                "INSERT INTO teams (prefix, template, task, project_id, created_at, members, permanent) "
                "VALUES ('db-crew','SQUAD_MODEL','Ship it','proj-x','2026-08-21T00:00:00Z',"
                "'[\"db-crew-lead\"]',0)"
            )
        r = client.get("/api/teams")
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        team = data["teams"][0]
        assert team["prefix"] == "db-crew"
        assert team["task"] == "Ship it"
        assert team["project_id"] == "proj-x"
        assert "permanent" not in team  # only emitted when set
        assert team["members"][0]["name"] == "db-crew-lead"

        r = client.get("/api/teams/db-crew")
        assert r.status_code == 200

    def test_route_lazy_import_populates_table_and_keeps_file(self, client, tmp_path, monkeypatch):
        from src.server.routes import teams as teams_route
        view = tmp_path / "teams.json"
        view.write_text(json.dumps({
            "teams": [{
                "prefix": "perm", "template": "FEATURE_TEAM", "task": "permanent team",
                "members": ["perm-lead"], "project_id": "p1", "permanent": True,
                "created_at": "2026-08-01T00:00:00Z",
            }]
        }))
        monkeypatch.setattr(teams_route, "get_teams_file", lambda: view)

        r = client.get("/api/teams/perm")
        assert r.status_code == 200
        assert r.json()["permanent"] is True

        rows = _query(Path(settings.db_path),
                      "SELECT prefix, members, permanent FROM teams")
        assert rows == [("perm", '["perm-lead"]', 1)]
        # File kept and canonicalized as the regenerated view
        data = json.loads(view.read_text())
        assert data["teams"][0]["permanent"] is True
        assert view.read_text().endswith("\n")

    def test_bash_record_remove_and_view_parity(self, sandbox, monkeypatch):
        db = _sandbox_db(sandbox)
        view = sandbox / ".soren" / "teams.json"

        # Record teams through the master directly (teams setup spawns real
        # workers — out of scope here) and let the bash tool regenerate the
        # view: `teams list` regenerates when the view file is missing.
        _run(TEAMS_TOOL, "list", root=sandbox)  # init schema + empty view
        assert json.loads(view.read_text()) == {"teams": []}

        _exec(db,
              "INSERT INTO teams (prefix, template, task, project_id, created_at, members, permanent) "
              "VALUES ('alpha','TIGER_TEAM','fix ït','','2026-08-21T01:00:00Z',"
              "'[\"alpha-a\",\"alpha-b\"]',0)")
        _exec(db,
              "INSERT INTO teams (prefix, template, task, project_id, created_at, members, permanent) "
              "VALUES ('core','SQUAD_MODEL','permanent team','p1','2026-08-21T02:00:00Z',"
              "'[\"core-lead\"]',1)")
        view.unlink()
        out = _run(TEAMS_TOOL, "list", root=sandbox)  # regenerates the view
        assert "alpha" in out.stdout and "core" in out.stdout

        data = json.loads(view.read_text())
        assert [t["prefix"] for t in data["teams"]] == ["alpha", "core"]
        assert data["teams"][0]["members"] == ["alpha-a", "alpha-b"]
        assert "permanent" not in data["teams"][0]
        assert data["teams"][1]["permanent"] is True
        # Key order: permanent sits before created_at (legacy writer order)
        assert list(data["teams"][1].keys()) == [
            "prefix", "template", "task", "members", "project_id", "permanent", "created_at",
        ]

        # Byte parity with the python regenerator
        bash_bytes = view.read_bytes()
        from src.server.routes import teams as teams_route
        monkeypatch.setattr(teams_route, "get_teams_file", lambda: view)
        with get_db(db) as conn:
            teams_route._regenerate_view(conn)
        assert view.read_bytes() == bash_bytes, "bash and python teams view bytes differ"

        # teardown removes the row and regenerates the view
        _run(TEAMS_TOOL, "teardown", "alpha", root=sandbox)
        assert _query(db, "SELECT prefix FROM teams") == [("core",)]
        assert [t["prefix"] for t in json.loads(view.read_text())["teams"]] == ["core"]

    def test_bash_lazy_import_from_legacy_file(self, sandbox):
        db = _sandbox_db(sandbox)
        view = sandbox / ".soren" / "teams.json"
        view.write_text(json.dumps({
            "teams": [{
                "prefix": "old", "template": "DEBATE_PAIR", "task": "argue",
                "members": ["old-defender", "old-critic"], "project_id": "",
                "created_at": "2026-07-01T00:00:00Z",
            }]
        }))
        out = _run(TEAMS_TOOL, "list", root=sandbox)
        assert "old" in out.stdout
        rows = _query(db, "SELECT prefix, members FROM teams")
        assert rows == [("old", '["old-defender","old-critic"]')]
        assert view.exists()  # kept as the view


# ─────────────────────────────────────────────────────────────────────────────
# 3. Schedule — add/list/fire/clear on the table; fire is exactly-once
# ─────────────────────────────────────────────────────────────────────────────

class TestSchedule:
    def test_add_list_fire_refire_clear(self, sandbox):
        db = _sandbox_db(sandbox)

        out = _run(SCHEDULE_TOOL, "add", "0", "due right now", root=sandbox)
        assert "Scheduled" in out.stdout
        out = _run(SCHEDULE_TOOL, "add", "3600", "later item", root=sandbox)
        assert "Scheduled" in out.stdout
        sched_id_later = _query(db, "SELECT id FROM schedule WHERE note='later item'")[0][0]

        out = _run(SCHEDULE_TOOL, "list", root=sandbox)
        assert "due right now" in out.stdout and "later item" in out.stdout
        assert "2 item(s)" in out.stdout

        # fire → the due note, exactly once, exit 0
        out = _run(SCHEDULE_TOOL, "fire", root=sandbox)
        assert out.stdout.strip() == "due right now"
        rows = _query(db, "SELECT fired_at IS NOT NULL FROM schedule WHERE note='due right now'")
        assert rows == [(1,)]

        # refire → noop: exit 1, no output (sequential double-fire check)
        out = _run(SCHEDULE_TOOL, "fire", root=sandbox, check=False)
        assert out.returncode == 1
        assert out.stdout.strip() == ""

        # fired items no longer listed; pending count reflects only unfired
        out = _run(SCHEDULE_TOOL, "list", root=sandbox)
        assert "due right now" not in out.stdout
        assert "1 item(s)" in out.stdout

        # clear <id> removes one; clear removes everything
        out = _run(SCHEDULE_TOOL, "clear", "s_nonexistent", root=sandbox, check=False)
        assert out.returncode == 1
        _run(SCHEDULE_TOOL, "clear", sched_id_later, root=sandbox)
        _run(SCHEDULE_TOOL, "clear", root=sandbox)
        assert _query(db, "SELECT COUNT(*) FROM schedule") == [(0,)]

    def test_concurrent_fire_fires_exactly_once(self, sandbox):
        _run(SCHEDULE_TOOL, "add", "0", "race-note", root=sandbox)

        procs = [
            subprocess.Popen(
                ["bash", str(SCHEDULE_TOOL), "fire"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, cwd=sandbox, env=_env(sandbox),
            )
            for _ in range(6)
        ]
        outputs = []
        for p in procs:
            out, err = p.communicate(timeout=60)
            outputs.append(out)

        winners = [o for o in outputs if o.strip()]
        assert len(winners) == 1, f"note fired {len(winners)} times: {outputs}"
        assert winners[0].strip() == "race-note"

        # And it stays consumed
        out = _run(SCHEDULE_TOOL, "fire", root=sandbox, check=False)
        assert out.returncode == 1 and out.stdout.strip() == ""

    def test_add_concurrent_with_fire_is_not_lost(self, sandbox):
        """The legacy race: `add` between fire's read and rewrite was lost.
        With the table, an add issued while fires are running always lands."""
        _run(SCHEDULE_TOOL, "add", "0", "victim", root=sandbox)
        fires = [
            subprocess.Popen(
                ["bash", str(SCHEDULE_TOOL), "fire"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, cwd=sandbox, env=_env(sandbox),
            )
            for _ in range(3)
        ]
        adder = subprocess.Popen(
            ["bash", str(SCHEDULE_TOOL), "add", "3600", "survivor"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=sandbox, env=_env(sandbox),
        )
        for p in (*fires, adder):
            p.communicate(timeout=60)
        assert adder.returncode == 0
        rows = _query(_sandbox_db(sandbox),
                      "SELECT COUNT(*) FROM schedule WHERE note='survivor' AND fired_at IS NULL")
        assert rows == [(1,)]

    def test_legacy_file_imported_once_and_renamed(self, sandbox):
        db = _sandbox_db(sandbox)
        legacy = sandbox / ".soren" / "schedule.json"
        legacy.write_text(json.dumps([
            {"id": "s_old00001", "note": "from the file era", "due_at": 1, "created_at": 1},
        ]))

        out = _run(SCHEDULE_TOOL, "list", root=sandbox)
        assert "from the file era" in out.stdout
        assert _query(db, "SELECT id, fired_at FROM schedule") == [("s_old00001", None)]
        assert not legacy.exists()
        assert legacy.with_name("schedule.json.migrated").exists()

        # Imported (overdue) item fires normally, once
        out = _run(SCHEDULE_TOOL, "fire", root=sandbox)
        assert out.stdout.strip() == "from the file era"


# ─────────────────────────────────────────────────────────────────────────────
# 4a. Prefs — API roundtrip + defaults + lazy import of BOTH legacy stores
# ─────────────────────────────────────────────────────────────────────────────

class TestPrefsApi:
    DEFAULTS = {
        "heartbeat_warn_threshold": 900,
        "heartbeat_nudge_interval": 180,
        "heartbeat_max_nudges": 3,
        "heartbeat_observe_timeout": 1200,
        # P5.2 settings panel — the one setting synced through this endpoint.
        "ui_density": "comfortable",
    }

    def test_get_returns_defaults_when_empty(self, client):
        r = client.get("/api/prefs")
        assert r.status_code == 200
        assert r.json() == self.DEFAULTS

    def test_put_roundtrip_and_persistence(self, client):
        r = client.put("/api/prefs", json={"heartbeat_warn_threshold": 555})
        assert r.status_code == 200
        assert r.json() == {**self.DEFAULTS, "heartbeat_warn_threshold": 555}

        # Persisted in the table with audit metadata
        rows = _query(Path(settings.db_path),
                      "SELECT value, updated_by FROM prefs WHERE key='heartbeat_warn_threshold'")
        assert rows == [("555", "api")]

        r = client.get("/api/prefs")
        assert r.json()["heartbeat_warn_threshold"] == 555
        # Untouched keys still default
        assert r.json()["heartbeat_max_nudges"] == 3

    def test_lazy_import_merges_both_stores_and_renames(self, client):
        soren_dir = Path(settings.soren_dir)
        preferences = soren_dir / "preferences.json"
        prefs_file = soren_dir / "prefs.json"
        # The drifted TARS-file: server-schema keys + TARS keys, no _meta
        preferences.write_text(json.dumps({
            "heartbeat_warn_threshold": 300,
            "idle_sleep_minutes": 30,
            "auto_compact_threshold": 0.85,
            "alertness": 9,
        }))
        # The server's own store — wins the conflicting key
        prefs_file.write_text(json.dumps({"heartbeat_warn_threshold": 111}))

        r = client.get("/api/prefs")
        assert r.status_code == 200
        body = r.json()
        # prefs.json wins the conflict; response stays the fixed key shape
        assert body["heartbeat_warn_threshold"] == 111
        assert set(body.keys()) == set(self.DEFAULTS.keys())

        # Everything imported verbatim into the merged table
        rows = dict(_query(Path(settings.db_path), "SELECT key, value FROM prefs"))
        assert rows["alertness"] == "9"
        assert rows["idle_sleep_minutes"] == "30"
        assert rows["auto_compact_threshold"] == "0.85"
        assert rows["heartbeat_warn_threshold"] == "111"

        # Both files renamed *.migrated
        assert not preferences.exists() and not prefs_file.exists()
        assert (soren_dir / "preferences.json.migrated").exists()
        assert (soren_dir / "prefs.json.migrated").exists()

        # Import never fires twice: a fresh GET keeps the merged values
        assert client.get("/api/prefs").json()["heartbeat_warn_threshold"] == 111


# ─────────────────────────────────────────────────────────────────────────────
# 4b. Prefs — bash tool set/get/reset against the shared table
# ─────────────────────────────────────────────────────────────────────────────

class TestPrefsBash:
    def test_set_get_reset_roundtrip(self, sandbox):
        db = _sandbox_db(sandbox)

        out = _run(PREFS_TOOL, "get", "humor", root=sandbox)
        assert "humor" in out.stdout and "3" in out.stdout  # default

        _run(PREFS_TOOL, "set", "humor", "8", root=sandbox)
        assert _query(db, "SELECT value, updated_by FROM prefs WHERE key='humor'") == [("8", "test-agent")]
        out = _run(PREFS_TOOL, "get", "humor", root=sandbox)
        assert "8" in out.stdout

        out = _run(PREFS_TOOL, "set", "humor", "11", root=sandbox, check=False)
        assert out.returncode != 0  # 1-10 validation intact

        out = _run(PREFS_TOOL, "list", root=sandbox)
        assert "alertness" in out.stdout and "journal_detail" in out.stdout

        _run(PREFS_TOOL, "reset", root=sandbox)
        assert _query(db, "SELECT value FROM prefs WHERE key='humor'") == [("3",)]

    def test_bash_lazy_import_both_files(self, sandbox):
        db = _sandbox_db(sandbox)
        preferences = sandbox / ".soren" / "preferences.json"
        prefs_file = sandbox / ".soren" / "prefs.json"
        preferences.write_text(json.dumps({
            "alertness": 2, "heartbeat_warn_threshold": 300,
            "_meta": {"updated_at": "2026-01-01T00:00:00Z", "updated_by": "old-agent"},
        }))
        prefs_file.write_text(json.dumps({"heartbeat_warn_threshold": 222}))

        out = _run(PREFS_TOOL, "get", "alertness", root=sandbox)
        assert "2" in out.stdout

        rows = dict(_query(db, "SELECT key, value FROM prefs"))
        assert rows["alertness"] == "2"
        assert rows["heartbeat_warn_threshold"] == "222"  # prefs.json wins
        # _meta became row audit columns, not a row
        assert "_meta" not in rows
        assert _query(db, "SELECT updated_by FROM prefs WHERE key='alertness'") == [("old-agent",)]

        assert not preferences.exists() and not prefs_file.exists()
        assert preferences.with_name("preferences.json.migrated").exists()
        assert prefs_file.with_name("prefs.json.migrated").exists()

        # reset only touches the six TARS keys — server keys survive
        _run(PREFS_TOOL, "reset", root=sandbox)
        rows = dict(_query(db, "SELECT key, value FROM prefs"))
        assert rows["alertness"] == "7"
        assert rows["heartbeat_warn_threshold"] == "222"
