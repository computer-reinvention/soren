"""Tests for services shipped in the v1 sprint.

Covers: task_dag, blocker_detector, pattern_extractor,
        quality_metrics (via /api/metrics).
"""

import sqlite3
import textwrap
from datetime import datetime, timezone
from pathlib import Path

import pytest

import src.server.services.task_dag as task_dag
import src.server.services.blocker_detector as blocker_detector
import src.server.services.pattern_extractor as pattern_extractor


# ─────────────────────────────────────────────────────────────────────────────
# Shared DB fixtures
# ─────────────────────────────────────────────────────────────────────────────

_TASKS_SCHEMA = """
CREATE TABLE tasks (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    project         TEXT DEFAULT '',
    assigned_to     TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    priority        TEXT DEFAULT 'medium',
    source          TEXT DEFAULT 'system',
    parent_id       TEXT DEFAULT '',
    resources       TEXT DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    completed_at    TEXT DEFAULT '',
    linked_workers  TEXT DEFAULT '',
    remarks         TEXT DEFAULT '',
    tags            TEXT DEFAULT '[]',
    due_date        TEXT DEFAULT ''
);
CREATE TABLE task_dependencies (
    task_id    TEXT NOT NULL,
    depends_on TEXT NOT NULL,
    PRIMARY KEY (task_id, depends_on)
);
CREATE INDEX idx_task_deps_dep ON task_dependencies(depends_on);
CREATE TABLE task_status_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     TEXT NOT NULL,
    old_status  TEXT DEFAULT '',
    new_status  TEXT NOT NULL,
    changed_at  TEXT NOT NULL
);
"""


@pytest.fixture()
def tasks_db():
    """Tasks schema created inside the per-test consolidated soren.db.

    task_dag, blocker_detector, and routes/tasks all resolve the DB path
    dynamically via services/db.py, which the autouse conftest fixture points
    at <tmp>/.soren/soren.db — so creating the tasks tables there wires
    everything up with no monkeypatching.
    """
    from src.server.services.db import get_db_path

    db = get_db_path()
    conn = sqlite3.connect(str(db))
    conn.executescript(_TASKS_SCHEMA)
    conn.close()
    return db


@pytest.fixture()
def tasks_client(client, tasks_db):
    """HTTP client with the tasks schema present in the consolidated test DB."""
    return client


def _mk_task(
    db: Path,
    task_id: str,
    title: str = "",
    status: str = "pending",
    project: str = "test",
    description: str = "",
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(str(db))
    conn.execute(
        """INSERT INTO tasks
           (id, title, description, status, project, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (task_id, title or task_id, description, status, project, now, now),
    )
    conn.commit()
    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# task_dag — unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestTaskDag:

    def test_add_and_get_dependency(self, tasks_db):
        """add_dependency + get_dependencies round-trip."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")   # B waits for A
        assert "A" in task_dag.get_dependencies("B")
        assert task_dag.get_dependencies("A") == []

    def test_get_dependents(self, tasks_db):
        """get_dependents returns tasks that wait on the given task."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")
        assert "B" in task_dag.get_dependents("A")
        assert task_dag.get_dependents("B") == []

    def test_cycle_detection_self_loop(self, tasks_db):
        """A task cannot depend on itself."""
        _mk_task(tasks_db, "A")
        with pytest.raises(ValueError, match="cycle"):
            task_dag.add_dependency("A", "A")

    def test_cycle_detection_chain(self, tasks_db):
        """Adding the final edge that closes a cycle raises ValueError."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        _mk_task(tasks_db, "C")
        task_dag.add_dependency("B", "A")   # A → B
        task_dag.add_dependency("C", "B")   # B → C
        # A waiting for C would create A → B → C → A
        with pytest.raises(ValueError, match="cycle"):
            task_dag.add_dependency("A", "C")

    def test_detect_cycle_helper(self, tasks_db):
        """detect_cycle returns True iff adding the edge would form a cycle."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")   # B depends on A
        assert task_dag.detect_cycle("A", "B") is True   # A → B creates A→B→A
        assert task_dag.detect_cycle("A", "A") is True   # self-loop
        assert task_dag.detect_cycle("A", "Z") is False  # Z unknown → no path

    def test_topological_sort_linear(self, tasks_db):
        """Linear chain A → B → C is sorted A, B, C."""
        for t in ("A", "B", "C"):
            _mk_task(tasks_db, t)
        task_dag.add_dependency("B", "A")
        task_dag.add_dependency("C", "B")
        order = task_dag.topological_sort()
        assert order.index("A") < order.index("B") < order.index("C")

    def test_topological_sort_parallel(self, tasks_db):
        """A and B independent; C depends on both — C must come last."""
        for t in ("A", "B", "C"):
            _mk_task(tasks_db, t)
        task_dag.add_dependency("C", "A")
        task_dag.add_dependency("C", "B")
        order = task_dag.topological_sort()
        assert order.index("A") < order.index("C")
        assert order.index("B") < order.index("C")

    def test_topological_sort_excludes_done(self, tasks_db):
        """Done tasks are excluded from the sort result."""
        _mk_task(tasks_db, "A", status="done")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")
        order = task_dag.topological_sort()
        assert "A" not in order
        assert "B" in order

    def test_get_ready_tasks(self, tasks_db):
        """Ready = pending/assigned with all deps done or no deps."""
        _mk_task(tasks_db, "done-dep",   status="done")
        _mk_task(tasks_db, "ready",      status="pending")   # dep is done
        _mk_task(tasks_db, "not-ready",  status="pending")   # dep is pending
        _mk_task(tasks_db, "blocker",    status="pending")   # blocks not-ready
        _mk_task(tasks_db, "no-deps",    status="pending")   # no deps at all

        task_dag.add_dependency("ready",     "done-dep")
        task_dag.add_dependency("not-ready", "blocker")

        ready = task_dag.get_ready_tasks()
        assert "ready"     in ready
        assert "no-deps"   in ready
        assert "blocker"   in ready     # has no unmet deps itself
        assert "not-ready" not in ready  # blocked by "blocker" (still pending)
        assert "done-dep"  not in ready  # done tasks excluded

    def test_remove_dependency(self, tasks_db):
        """remove_dependency returns True and the edge disappears."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")
        assert task_dag.remove_dependency("B", "A") is True
        assert task_dag.get_dependencies("B") == []

    def test_remove_nonexistent_dependency(self, tasks_db):
        """remove_dependency returns False when edge does not exist."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        assert task_dag.remove_dependency("B", "A") is False

    def test_add_dependency_missing_task(self, tasks_db):
        """Adding a dependency to a non-existent task raises ValueError."""
        _mk_task(tasks_db, "A")
        with pytest.raises(ValueError, match="not found"):
            task_dag.add_dependency("A", "ghost")

    def test_idempotent_add(self, tasks_db):
        """Adding the same edge twice does not error (INSERT OR IGNORE)."""
        _mk_task(tasks_db, "A")
        _mk_task(tasks_db, "B")
        task_dag.add_dependency("B", "A")
        task_dag.add_dependency("B", "A")   # second add is a no-op
        assert task_dag.get_dependencies("B").count("A") == 1


# ─────────────────────────────────────────────────────────────────────────────
# blocker_detector — unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestBlockerDetector:

    # ── code-level checks (filesystem) ───────────────────────────────────────

    def test_no_src_server_returns_empty(self, tmp_path):
        """If src/server doesn't exist, we're not a Python backend project."""
        result = blocker_detector.check_code_blockers(
            "Call /api/widgets to fetch data", project_path=str(tmp_path)
        )
        assert result == []

    def test_missing_api_route_flagged(self, tmp_path):
        """Frontend references /api/nonexistent — no route file → blocker."""
        (tmp_path / "src" / "server" / "routes").mkdir(parents=True)
        (tmp_path / "src" / "server" / "main.py").write_text("")
        result = blocker_detector.check_code_blockers(
            "This task calls /api/nonexistent-xyz endpoint",
            project_path=str(tmp_path),
        )
        missing = [b for b in result if b["type"] == "missing_code"]
        assert any("nonexistent-xyz" in b["reference"] for b in missing)

    def test_existing_api_route_not_flagged(self, tmp_path):
        """Route file exists with matching content → no blocker for that segment."""
        routes = tmp_path / "src" / "server" / "routes"
        routes.mkdir(parents=True)
        (tmp_path / "src" / "server" / "main.py").write_text("")
        (routes / "gadgets.py").write_text(
            '@router.get("/gadgets")\nasync def list_gadgets(): ...\n'
        )
        result = blocker_detector.check_code_blockers(
            "Use /api/gadgets to list all gadgets",
            project_path=str(tmp_path),
        )
        missing = [b for b in result if b["type"] == "missing_code"]
        assert not any("gadgets" in b.get("reference", "") for b in missing)

    def test_missing_module_reference_flagged(self, tmp_path):
        """services.ghostmodule referenced but file missing → blocker."""
        (tmp_path / "src" / "server" / "services").mkdir(parents=True)
        (tmp_path / "src" / "server" / "routes").mkdir(parents=True)
        (tmp_path / "src" / "server" / "main.py").write_text("")
        result = blocker_detector.check_code_blockers(
            "Import from services.ghostmodule to handle the request",
            project_path=str(tmp_path),
        )
        assert any("ghostmodule" in b.get("reference", "") for b in result)

    def test_existing_module_not_flagged(self, tmp_path):
        """services.realmodule exists → no missing_code blocker for it."""
        svc = tmp_path / "src" / "server" / "services"
        svc.mkdir(parents=True)
        (tmp_path / "src" / "server" / "routes").mkdir(parents=True)
        (tmp_path / "src" / "server" / "main.py").write_text("")
        (svc / "realmodule.py").write_text("# real module\n")
        result = blocker_detector.check_code_blockers(
            "Import from services.realmodule to process data",
            project_path=str(tmp_path),
        )
        missing = [b for b in result if b["type"] == "missing_code"]
        assert not any("realmodule" in b.get("reference", "") for b in missing)

    # ── DAG-based checks ──────────────────────────────────────────────────────

    def test_scan_active_tasks_empty_db(self, tasks_db):
        """No tasks in DB → empty blockers, 0 scanned."""
        result = blocker_detector.scan_all_active_tasks()
        assert result["blockers"] == []
        assert result["summary"]["total_blockers"] == 0
        assert result["summary"]["tasks_scanned"] == 0

    def test_check_task_blockers_unmet_dep(self, tasks_db):
        """Task depends on an in-progress task → blocker reported."""
        _mk_task(tasks_db, "dep-1",  status="in-progress")
        _mk_task(tasks_db, "task-1", status="in-progress")
        task_dag.add_dependency("task-1", "dep-1")
        blockers = blocker_detector.check_task_blockers("task-1")
        assert len(blockers) == 1
        assert blockers[0]["dep_task_id"] == "dep-1"
        assert blockers[0]["type"] == "unmet_dependency"

    def test_check_task_blockers_dep_done(self, tasks_db):
        """Task whose dependency is done → no blockers."""
        _mk_task(tasks_db, "dep-done",  status="done")
        _mk_task(tasks_db, "task-ok",   status="pending")
        task_dag.add_dependency("task-ok", "dep-done")
        assert blocker_detector.check_task_blockers("task-ok") == []

    def test_check_task_blockers_no_deps(self, tasks_db):
        """Task with no dependencies → no blockers."""
        _mk_task(tasks_db, "standalone", status="in-progress")
        assert blocker_detector.check_task_blockers("standalone") == []

    def test_severity_critical_for_failed_dep(self, tasks_db):
        """Failed dependency → severity is critical."""
        _mk_task(tasks_db, "failed-dep", status="failed")
        _mk_task(tasks_db, "task-crit",  status="in-progress")
        task_dag.add_dependency("task-crit", "failed-dep")
        blockers = blocker_detector.check_task_blockers("task-crit")
        assert blockers[0]["severity"] == "critical"

    def test_severity_warning_for_unassigned_pending(self, tasks_db):
        """Unassigned pending dependency → severity is warning."""
        _mk_task(tasks_db, "unassigned-dep", status="pending")
        _mk_task(tasks_db, "task-warn",      status="in-progress")
        task_dag.add_dependency("task-warn", "unassigned-dep")
        blockers = blocker_detector.check_task_blockers("task-warn")
        assert blockers[0]["severity"] == "warning"


# ─────────────────────────────────────────────────────────────────────────────
# pattern_extractor — unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestPatternExtractor:

    def test_extract_from_head_commit_returns_list(self):
        """extract_patterns_from_commit('HEAD') returns a list, never raises."""
        patterns = pattern_extractor.extract_patterns_from_commit("HEAD")
        assert isinstance(patterns, list)
        for p in patterns:
            assert "pattern" in p
            assert "source_commit" in p
            assert "confidence" in p
            assert len(p["pattern"]) >= 25

    def test_extract_from_commit_keyword_match(self, monkeypatch):
        """Body lines containing keywords → extracted as patterns."""
        def mock_git(args, cwd=None):
            if "--format=%B" in args:
                return (
                    "feat: add widget\n\n"
                    "Always use PRAGMA table_info before ALTER TABLE to keep migrations idempotent.\n"
                    "Never commit directly to the main branch.\n"
                )
            if "--stat" in args:
                return "src/server/services/widget.py | 5 +\n"
            return ""

        monkeypatch.setattr(pattern_extractor, "_run_git", mock_git)
        patterns = pattern_extractor.extract_patterns_from_commit("abc1234")
        texts = [p["pattern"] for p in patterns]
        assert any("PRAGMA" in t or "idempotent" in t for t in texts)
        assert any("Never commit" in t or "main branch" in t for t in texts)

    def test_extract_from_commit_structural_route_pattern(self, monkeypatch):
        """Changed routes/ + main.py → route registration structural pattern."""
        def mock_git(args, cwd=None):
            if "--format=%B" in args:
                return "feat: add new API route\n\nAdded endpoint.\n"
            if "--stat" in args:
                return (
                    "src/server/routes/widgets.py | 20 ++++\n"
                    "src/server/main.py           |  2 +-\n"
                )
            return ""

        monkeypatch.setattr(pattern_extractor, "_run_git", mock_git)
        patterns = pattern_extractor.extract_patterns_from_commit("def5678")
        route_patterns = [
            p for p in patterns if "include_router" in p["pattern"] or "routes/" in p["pattern"]
        ]
        assert len(route_patterns) >= 1
        assert route_patterns[0]["confidence"] == "high"

    def test_extract_from_commit_empty_on_bad_sha(self, monkeypatch):
        """Invalid commit SHA returns empty list gracefully."""
        monkeypatch.setattr(pattern_extractor, "_run_git", lambda *a, **kw: "")
        patterns = pattern_extractor.extract_patterns_from_commit("0000000")
        assert patterns == []

    def test_extract_from_journal_key_decisions(self, tmp_path, monkeypatch):
        """Journal 'Key decisions' section yields bullet points as patterns."""
        from src.server.config import settings as cfg
        date = "2026-02-25"
        journal_dir = tmp_path / ".soren" / "journal" / date
        journal_dir.mkdir(parents=True)
        (journal_dir / "journal.md").write_text(textwrap.dedent("""\
            # Daily Journal

            ## Key decisions

            - Always use PRAGMA table_info before ALTER TABLE to keep migrations idempotent
            - Never commit directly to main branch, always use feature branches
            - Prefer explicit error messages with full context over bare exceptions

            ## Status update

            Everything else going well today.
        """))
        monkeypatch.setattr(cfg, "soren_dir", tmp_path / ".soren")
        patterns = pattern_extractor.extract_patterns_from_journal(date)
        assert len(patterns) >= 2
        texts = [p["pattern"] for p in patterns]
        assert any("PRAGMA" in t or "idempotent" in t for t in texts)
        assert all(p["confidence"] == "medium" for p in patterns)
        assert all(p["source_commit"] == "" for p in patterns)

    def test_extract_from_journal_non_pattern_section_ignored(self, tmp_path, monkeypatch):
        """Sections not matching pattern keywords are not extracted."""
        from src.server.config import settings as cfg
        date = "2026-02-20"
        journal_dir = tmp_path / ".soren" / "journal" / date
        journal_dir.mkdir(parents=True)
        (journal_dir / "journal.md").write_text(textwrap.dedent("""\
            # Journal

            ## Status update

            - Reviewed the PR and left comments on the implementation details
            - Updated the documentation for the new endpoint usage patterns

            ## What I ate for lunch

            - A sandwich with lots of interesting ingredients from the fridge
        """))
        monkeypatch.setattr(cfg, "soren_dir", tmp_path / ".soren")
        patterns = pattern_extractor.extract_patterns_from_journal(date)
        # "Status update" is not a pattern section; "What I ate for lunch" is not either
        assert patterns == []

    def test_extract_from_journal_missing_file(self, tmp_path, monkeypatch):
        """Missing journal file → empty list, no exception."""
        from src.server.config import settings as cfg
        monkeypatch.setattr(cfg, "soren_dir", tmp_path / ".soren")
        patterns = pattern_extractor.extract_patterns_from_journal("1999-01-01")
        assert patterns == []

    def test_short_lines_filtered(self, tmp_path, monkeypatch):
        """Lines shorter than 25 characters are not extracted."""
        from src.server.config import settings as cfg
        date = "2026-02-21"
        journal_dir = tmp_path / ".soren" / "journal" / date
        journal_dir.mkdir(parents=True)
        (journal_dir / "journal.md").write_text(textwrap.dedent("""\
            # Journal

            ## Key decisions

            - Short line
            - x
            - This is a sufficiently long line that should be extracted as a useful pattern
        """))
        monkeypatch.setattr(cfg, "soren_dir", tmp_path / ".soren")
        patterns = pattern_extractor.extract_patterns_from_journal(date)
        assert len(patterns) == 1
        assert "sufficiently long" in patterns[0]["pattern"]


# ─────────────────────────────────────────────────────────────────────────────
# quality_metrics — via /api/metrics HTTP endpoints
# ─────────────────────────────────────────────────────────────────────────────

class TestQualityMetrics:

    def test_quality_endpoint_structure_empty(self, client):
        """GET /api/metrics/quality returns expected shape with no data."""
        resp = client.get("/api/metrics/quality")
        assert resp.status_code == 200
        data = resp.json()
        assert "agents" in data
        assert "summary" in data
        summary = data["summary"]
        for key in ("total_completions", "total_failures", "total_cost_usd"):
            assert key in summary

    def test_quality_cost_appears_after_agent_event(self, client):
        """Posting a Stop event with usage → agent appears in quality report with cost."""
        client.post("/api/agent-events", json={
            "event_type": "Stop",
            "session_id": "sess-met-1",
            "agent_id": "metrics-test-worker",
            "usage": {
                "input_tokens": 2000,
                "output_tokens": 400,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
        })
        resp = client.get("/api/metrics/quality")
        assert resp.status_code == 200
        agents = resp.json()["agents"]
        agent = next((a for a in agents if a["agent_id"] == "metrics-test-worker"), None)
        assert agent is not None
        assert agent["total_cost_usd"] > 0

    def test_quality_no_completions_gives_none_ratios(self, client):
        """Agent with cost but no completions → per-dollar ratios are None."""
        client.post("/api/agent-events", json={
            "event_type": "Stop",
            "session_id": "sess-met-2",
            "agent_id": "metrics-no-completions",
            "usage": {
                "input_tokens": 500,
                "output_tokens": 100,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0,
            },
        })
        resp = client.get("/api/metrics/quality")
        agent = next(
            (a for a in resp.json()["agents"] if a["agent_id"] == "metrics-no-completions"),
            None,
        )
        assert agent is not None
        assert agent["completions_per_dollar"] is None
        assert agent["cost_per_completion_usd"] is None
        assert agent["success_rate"] == 0.0

    def test_quality_agent_not_found_returns_404(self, client):
        """GET /api/metrics/quality/{unknown} → 404."""
        resp = client.get("/api/metrics/quality/totally-unknown-agent-xyz")
        assert resp.status_code == 404

    def test_quality_agent_detail_returns_agent_and_summary(self, client):
        """Known agent after posting events → detail endpoint returns agent + summary."""
        client.post("/api/agent-events", json={
            "event_type": "Stop",
            "session_id": "sess-met-3",
            "agent_id": "metrics-detail-agent",
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 250,
                "cache_read_input_tokens": 50,
                "cache_creation_input_tokens": 0,
            },
        })
        resp = client.get("/api/metrics/quality/metrics-detail-agent")
        assert resp.status_code == 200
        data = resp.json()
        assert "agent" in data
        assert "summary" in data
        assert data["agent"]["agent_id"] == "metrics-detail-agent"
        assert data["agent"]["total_cost_usd"] > 0


# ─────────────────────────────────────────────────────────────────────────────
# Task DAG HTTP endpoints — via /api/tasks
# ─────────────────────────────────────────────────────────────────────────────

class TestTaskDagEndpoints:

    def _create(self, tasks_client, title: str) -> str:
        resp = tasks_client.post("/api/tasks", json={"title": title, "source": "user"})
        assert resp.status_code == 201, resp.text
        return resp.json()["id"]

    def test_add_dependency_via_api(self, tasks_client):
        """POST /{id}/depends-on/{dep} creates the edge; GET /dependencies confirms."""
        parent = self._create(tasks_client, "Parent task")
        child  = self._create(tasks_client, "Child task")

        resp = tasks_client.post(f"/api/tasks/{child}/depends-on/{parent}")
        assert resp.status_code == 200

        resp = tasks_client.get(f"/api/tasks/{child}/dependencies")
        assert resp.status_code == 200
        data = resp.json()
        assert parent in data["depends_on"]

    def test_add_dependency_cycle_returns_400(self, tasks_client):
        """Adding an edge that would create a cycle → 400."""
        a = self._create(tasks_client, "Task A")
        b = self._create(tasks_client, "Task B")
        tasks_client.post(f"/api/tasks/{b}/depends-on/{a}")   # B waits for A

        resp = tasks_client.post(f"/api/tasks/{a}/depends-on/{b}")  # would be A←B←A
        assert resp.status_code == 400

    def test_remove_dependency_via_api(self, tasks_client):
        """DELETE /{id}/depends-on/{dep} removes the edge."""
        a = self._create(tasks_client, "A")
        b = self._create(tasks_client, "B")
        tasks_client.post(f"/api/tasks/{b}/depends-on/{a}")

        resp = tasks_client.delete(f"/api/tasks/{b}/depends-on/{a}")
        assert resp.status_code == 200

        resp = tasks_client.get(f"/api/tasks/{b}/dependencies")
        assert a not in resp.json()["depends_on"]

    def test_dag_endpoint_structure(self, tasks_client):
        """GET /api/tasks/dag returns {nodes, edges}."""
        self._create(tasks_client, "Node one")
        resp = tasks_client.get("/api/tasks/dag")
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "edges" in data

    def test_execution_order_respects_deps(self, tasks_client):
        """GET /api/tasks/execution-order returns A before B when B depends on A."""
        a = self._create(tasks_client, "First step")
        b = self._create(tasks_client, "Second step")
        tasks_client.post(f"/api/tasks/{b}/depends-on/{a}")

        resp = tasks_client.get("/api/tasks/execution-order")
        assert resp.status_code == 200
        ids = [t["id"] for t in resp.json()["tasks"]]
        assert ids.index(a) < ids.index(b)

    def test_task_blockers_endpoint(self, tasks_client):
        """GET /api/tasks/{id}/blockers returns blocker list."""
        dep  = self._create(tasks_client, "Dependency")
        task = self._create(tasks_client, "Blocked task")
        tasks_client.post(f"/api/tasks/{task}/depends-on/{dep}")

        # Update dep to in-progress so it appears as an unmet blocker
        tasks_client.patch(f"/api/tasks/{dep}", json={"status": "in-progress"})
        tasks_client.patch(f"/api/tasks/{task}", json={"status": "in-progress"})

        resp = tasks_client.get(f"/api/tasks/{task}/blockers")
        assert resp.status_code == 200
        data = resp.json()
        assert "blockers" in data
        assert "total" in data
