"""Tests for the file→table state migrations (PR: state tables).

Covers the five mechanisms converted from racy file-based storage to tables in
the consolidated DB (.soren/soren.db):

1. fix_retries      — retry counters + escalation latches (verify-done.sh)
2. compact_timestamps — per-window compaction epochs (compact.sh + agent_events.py)
3. spawn_events     — spawn rate-limit ledger (tools/workers)
4. verify_events    — structured verification history (verify-done.sh + tools/verifications)
5. secrets_vault    — encrypted secret blob (services/secrets.py)

Bash-driven tests sandbox everything via SOREN_HOME/SOREN_DB pointing at a tmp
dir; the live .soren/ is never touched.
"""

import base64
import json
import os
import sqlite3
import subprocess
import threading
import time
from pathlib import Path

import pytest

from src.server.config import settings

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VERIFY_HOOK = PROJECT_ROOT / ".opencode" / "hooks" / "verify-done.sh"
VERIFICATIONS = PROJECT_ROOT / "tools" / "verifications"
WORKERS = PROJECT_ROOT / "tools" / "workers"
DB_LIB = PROJECT_ROOT / "tools" / "lib" / "db.sh"


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


def _try_query(db_path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    """_query that returns [] while the db/table doesn't exist yet (polling)."""
    if not db_path.exists():
        return []
    try:
        return _query(db_path, sql, params)
    except sqlite3.OperationalError:
        return []


def _poll(fn, timeout: float = 15.0, interval: float = 0.2):
    """Poll fn() until it returns a truthy value or timeout; returns the value."""
    deadline = time.monotonic() + timeout
    result = None
    while time.monotonic() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(interval)
    return result


@pytest.fixture
def sandbox(tmp_path):
    """A verify-done sandbox: fake SOREN_HOME with stub mailbox + real db.sh.

    Layout:
        <tmp>/tools/mailbox   — stub that logs its args
        <tmp>/tools/lib       — symlink to the real tools/lib (db.sh etc.)
        <tmp>/tools/workers   — symlink to the real workers CLI
        <tmp>/.soren/         — runtime dir (status.log, soren.db, ...)
        <tmp>/                — a git repo (for commit-verification paths)
    """
    root = tmp_path / "sbx"
    (root / ".soren").mkdir(parents=True)
    tools = root / "tools"
    tools.mkdir()
    (tools / "lib").symlink_to(PROJECT_ROOT / "tools" / "lib")
    (tools / "workers").symlink_to(WORKERS)
    (tools / "verifications").symlink_to(VERIFICATIONS)

    stub = tools / "mailbox"
    stub.write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%s\\n\' "$*" >> "$(dirname "$0")/../.soren/mailbox-stub.log"\n'
    )
    stub.chmod(0o755)

    subprocess.run(
        ["git", "init", "-q"], cwd=root, check=True,
        env={**os.environ, "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"},
    )
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=root, check=True)

    return root


def _hook_env(root: Path, agent: str = "test-agent") -> dict:
    return {
        **os.environ,
        "SOREN_AGENT": "true",
        "SOREN_AGENT_NAME": agent,
        "SOREN_SUPERVISOR": "supervisor",
        "SOREN_HOME": str(root),
        "SOREN_DB": str(root / ".soren" / "soren.db"),
        "SOREN_PORT": "59999",  # dead port — the hook's curl calls fail fast
        "SOREN_PROJECT_ID": "soren",  # keep commit resolution inside the sandbox
    }


def _fire_done(root: Path, message: str, agent: str = "test-agent") -> None:
    """Invoke verify-done.sh as the plugin would: JSON on stdin."""
    payload = json.dumps({
        "tool_name": "Bash",
        "tool_input": {"command": f"./tools/mailbox done '{message}'"},
    })
    subprocess.run(
        ["bash", str(VERIFY_HOOK)],
        input=payload, text=True, cwd=root,
        env=_hook_env(root, agent), check=True, capture_output=True,
    )


def _sandbox_db(root: Path) -> Path:
    return root / ".soren" / "soren.db"


def _mailbox_log(root: Path) -> str:
    log = root / ".soren" / "mailbox-stub.log"
    return log.read_text() if log.exists() else ""


# ─────────────────────────────────────────────────────────────────────────────
# 1. fix_retries — atomic increments + latch state machine
# ─────────────────────────────────────────────────────────────────────────────

class TestFixRetries:
    UPSERT = (
        "INSERT INTO fix_retries (agent, task_key, retries, escalated, updated_at) "
        "VALUES ('a1', 'k1', 1, 0, 'now') "
        "ON CONFLICT(agent, task_key) DO UPDATE SET retries = retries + 1 "
        "RETURNING retries;"
    )
    SCHEMA = (
        "CREATE TABLE IF NOT EXISTS fix_retries ("
        "agent TEXT NOT NULL, task_key TEXT NOT NULL, "
        "retries INTEGER NOT NULL DEFAULT 0, escalated INTEGER NOT NULL DEFAULT 0, "
        "updated_at TEXT, PRIMARY KEY (agent, task_key));"
    )

    def test_returning_supported(self, tmp_path):
        """RETURNING (sqlite3 >= 3.35) must work on this system's sqlite3 CLI."""
        db = tmp_path / "r.db"
        out = subprocess.run(
            ["sqlite3", str(db), self.SCHEMA + self.UPSERT],
            capture_output=True, text=True,
        )
        assert out.returncode == 0, out.stderr
        assert out.stdout.strip() == "1"

    def test_concurrent_increments_lose_nothing(self, tmp_path):
        """N parallel UPSERTs (the exact statement verify-done.sh runs, via
        soren_db/db.sh with SOREN_DB sandboxing) must yield retries == N and
        return each intermediate count exactly once."""
        db = tmp_path / "c.db"
        subprocess.run(["sqlite3", str(db), self.SCHEMA], check=True)

        n = 8
        script = f'source "{DB_LIB}"; soren_db "{self.UPSERT}"'
        procs = [
            subprocess.Popen(
                ["bash", "-c", script],
                env={**os.environ, "SOREN_DB": str(db)},
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            for _ in range(n)
        ]
        outputs = []
        for p in procs:
            out, err = p.communicate(timeout=30)
            assert p.returncode == 0, err
            outputs.append(out.strip())

        rows = _query(db, "SELECT retries FROM fix_retries WHERE agent='a1' AND task_key='k1'")
        assert rows == [(n,)], f"lost increments: {rows}"
        # RETURNING handed each writer a distinct post-increment value
        assert sorted(int(o) for o in outputs) == list(range(1, n + 1))

    def test_verify_done_concurrent_dones_count_both(self, sandbox):
        """The real race: two concurrent [DONE]s for the same task key must
        both be counted (old count files lost one increment)."""
        msg = "task finished but commit is missing here"  # no hex run >= 7
        payload = json.dumps({
            "tool_name": "Bash",
            "tool_input": {"command": f"./tools/mailbox done '{msg}'"},
        })
        env = _hook_env(sandbox)
        procs = [
            subprocess.Popen(
                ["bash", str(VERIFY_HOOK)], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, cwd=sandbox, env=env,
            )
            for _ in range(2)
        ]
        for p in procs:
            p.communicate(input=payload, timeout=30)

        db = _sandbox_db(sandbox)
        assert _poll(lambda: _try_query(
            db, "SELECT retries FROM fix_retries WHERE agent='test-agent'") == [(2,)]), (
            f"expected retries=2, got "
            f"{_try_query(db, 'SELECT retries FROM fix_retries')}")
        assert _poll(lambda: _try_query(
            db, "SELECT COUNT(*) FROM verify_events WHERE event='FIX-REQUEST'") == [(2,)])

    def test_legacy_dir_imported_once(self, sandbox):
        """Pre-migration .fix-retries files are imported and the dir renamed."""
        legacy = sandbox / ".soren" / ".fix-retries"
        legacy.mkdir()
        (legacy / "agentx-abcdef1").write_text("2")
        (legacy / "agentx-abcdef1.escalated").touch()
        (legacy / "oldagent").write_text("1")  # legacy keyless format

        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "latches"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox),
        )
        assert out.returncode == 0, out.stderr
        assert "agentx" in out.stdout and "abcdef1" in out.stdout

        db = _sandbox_db(sandbox)
        rows = _query(db, "SELECT agent, task_key, retries, escalated FROM fix_retries ORDER BY agent")
        assert ("agentx", "abcdef1", 2, 1) in rows
        assert ("oldagent", "default", 1, 0) in rows
        assert not legacy.exists()
        assert (sandbox / ".soren" / ".fix-retries.migrated").is_dir()


# ─────────────────────────────────────────────────────────────────────────────
# verify-done.sh end-to-end: events, retries, escalation, latch, clear
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifyDoneFlow:
    def test_missing_commit_writes_fix_request_event(self, sandbox):
        _fire_done(sandbox, "task finished but commit is missing here")
        db = _sandbox_db(sandbox)
        rows = _poll(lambda: _try_query(
            db, "SELECT event, agent, detail FROM verify_events WHERE event='FIX-REQUEST'"))
        assert rows, "no FIX-REQUEST event row written"
        assert rows[0][1] == "test-agent"
        assert "missing-commit" in rows[0][2]
        retries = _query(db, "SELECT retries, escalated FROM fix_retries WHERE agent='test-agent'")
        assert retries == [(1, 0)]
        assert "[FIX-REQUEST]" in _mailbox_log(sandbox)

    def test_noop_done_writes_skip_event_and_clears(self, sandbox):
        _fire_done(sandbox, "no-op: nothing changed, output-only task")
        db = _sandbox_db(sandbox)
        rows = _poll(lambda: _try_query(
            db, "SELECT event, task_key FROM verify_events WHERE event='SKIP-NOOP'"))
        assert rows, "no SKIP-NOOP event row written"
        assert rows[0][1]  # task_key populated (md5 of summary)
        assert _query(db, "SELECT * FROM fix_retries") == []
        assert "[VERIFIED]" in _mailbox_log(sandbox)

    def test_verified_commit_writes_verified_event(self, sandbox):
        (sandbox / "README.txt").write_text("hello\n")
        subprocess.run(["git", "add", "README.txt"], cwd=sandbox, check=True)
        subprocess.run(
            ["git", "commit", "-q", "-m", "docs"], cwd=sandbox, check=True)
        sha = subprocess.run(
            ["git", "rev-parse", "--short=8", "HEAD"], cwd=sandbox,
            capture_output=True, text=True, check=True).stdout.strip()

        _fire_done(sandbox, f"done, committed {sha} — added readme")
        db = _sandbox_db(sandbox)
        rows = _poll(lambda: _try_query(
            db, "SELECT event, commit_sha, task_key FROM verify_events WHERE event='VERIFIED'"))
        assert rows, "no VERIFIED event row written"
        assert rows[0][1] == sha
        assert rows[0][2] == sha  # commit hash is the task key
        assert "[VERIFIED]" in _mailbox_log(sandbox)

    def test_full_latch_cycle(self, sandbox):
        """2 retries → escalation → latched skip → clear-latch → cycle resumes."""
        msg = "work complete but there is no commit reported"
        db = _sandbox_db(sandbox)

        def event_count(ev):
            rows = _try_query(db, "SELECT COUNT(*) FROM verify_events WHERE event=?", (ev,))
            return rows[0][0] if rows else 0

        # attempts 1 and 2 → FIX-REQUEST each
        _fire_done(sandbox, msg)
        assert _poll(lambda: event_count("FIX-REQUEST") == 1)
        _fire_done(sandbox, msg)
        assert _poll(lambda: event_count("FIX-REQUEST") == 2)
        assert _query(db, "SELECT retries FROM fix_retries")[0][0] == 2

        # attempt 3 → escalation: VERIFY-FAILED event, latch set, counter reset
        _fire_done(sandbox, msg)
        assert _poll(lambda: event_count("VERIFY-FAILED") == 1)
        assert _query(db, "SELECT retries, escalated FROM fix_retries") == [(0, 1)]
        assert "[VERIFY-FAILED]" in _mailbox_log(sandbox)

        # attempt 4 → latched: no new FIX-REQUEST, LATCHED event only
        _fire_done(sandbox, msg)
        assert _poll(lambda: event_count("LATCHED") == 1)
        assert event_count("FIX-REQUEST") == 2

        # supervisor unblocks via clear-latch
        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "clear-latch", "test-agent"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        assert out.returncode == 0, out.stderr
        assert "Cleared 1 latch(es)" in out.stdout
        assert _query(db, "SELECT escalated FROM fix_retries") == [(0,)]

        # cycle resumes: next DONE gets a fresh FIX-REQUEST
        _fire_done(sandbox, msg)
        assert _poll(lambda: event_count("FIX-REQUEST") == 3)
        assert _query(db, "SELECT retries FROM fix_retries") == [(1,)]


# ─────────────────────────────────────────────────────────────────────────────
# tools/verifications — table reads + status.log fallback
# ─────────────────────────────────────────────────────────────────────────────

class TestVerifications:
    def test_recent_falls_back_to_status_log_when_table_empty(self, sandbox):
        status = sandbox / ".soren" / "status.log"
        status.write_text(
            "2026-08-21T10:00:00Z | [VERIFY] | legacy-agent | commit abc1234 verified in /x, files: 1\n")
        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "recent"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        assert out.returncode == 0, out.stderr
        assert "legacy-agent" in out.stdout

    def test_recent_reads_table_when_populated(self, sandbox):
        _fire_done(sandbox, "no-op: table-populating event")
        db = _sandbox_db(sandbox)
        assert _poll(lambda: _try_query(
            db, "SELECT 1 FROM verify_events WHERE event='SKIP-NOOP'"))
        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "recent"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        assert out.returncode == 0, out.stderr
        assert "test-agent" in out.stdout
        assert "no-op DONE" in out.stdout

    def test_pending_lists_active_counters(self, sandbox):
        _fire_done(sandbox, "task finished but commit is missing here")
        db = _sandbox_db(sandbox)
        assert _poll(lambda: _try_query(
            db, "SELECT 1 FROM fix_retries WHERE retries > 0"))
        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "pending"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        assert out.returncode == 0, out.stderr
        assert "test-agent" in out.stdout
        assert "1/2" in out.stdout

    def test_clear_latch_requires_existing_latch(self, sandbox):
        subprocess.run(  # ensure schema exists
            ["bash", str(VERIFICATIONS), "pending"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        out = subprocess.run(
            ["bash", str(VERIFICATIONS), "clear-latch", "nobody"],
            capture_output=True, text=True, cwd=sandbox, env=_hook_env(sandbox))
        assert out.returncode != 0
        assert "no latches found" in out.stderr


# ─────────────────────────────────────────────────────────────────────────────
# 2. compact_timestamps — python + subprocess writers, lazy import
# ─────────────────────────────────────────────────────────────────────────────

class TestCompactTimestamps:
    def test_upsert_from_python_and_subprocess(self):
        from src.server.routes.agent_events import (
            _get_last_compact_time,
            _set_last_compact_time,
        )

        _set_last_compact_time("win-a", 1000)
        assert _get_last_compact_time("win-a") == 1000.0

        # Subprocess writer (same upsert compact.sh runs via soren_db)
        db = Path(settings.db_path)
        subprocess.run(
            [
                "sqlite3", str(db),
                "INSERT INTO compact_timestamps (window, epoch, updated_at) "
                "VALUES ('win-a', 2000, 'x') "
                "ON CONFLICT(window) DO UPDATE SET epoch = excluded.epoch, "
                "updated_at = excluded.updated_at;",
            ],
            check=True,
        )
        assert _get_last_compact_time("win-a") == 2000.0

        # And python overwrites again — no lost updates in either direction
        _set_last_compact_time("win-a", 3000)
        assert _get_last_compact_time("win-a") == 3000.0

    def test_legacy_file_imported_once(self):
        from src.server.routes.agent_events import _get_last_compact_time

        legacy = Path(settings.soren_dir) / ".compact-timestamps"
        legacy.write_text("win-b=12345\nwin-c=67890\nnot a valid line\n")

        assert _get_last_compact_time("win-b") == 12345.0
        assert _get_last_compact_time("win-c") == 67890.0
        assert not legacy.exists()
        assert legacy.with_name(".compact-timestamps.migrated").exists()

    def test_import_keeps_newer_table_epoch(self):
        from src.server.routes.agent_events import (
            _get_last_compact_time,
            _set_last_compact_time,
        )

        _set_last_compact_time("win-d", 5000)
        legacy = Path(settings.soren_dir) / ".compact-timestamps"
        legacy.write_text("win-d=4000\n")  # stale file entry
        assert _get_last_compact_time("win-d") == 5000.0


# ─────────────────────────────────────────────────────────────────────────────
# 3. spawn_events — transactional rate limit in tools/workers
# ─────────────────────────────────────────────────────────────────────────────

class TestSpawnEvents:
    SCHEMA = (
        "CREATE TABLE IF NOT EXISTS spawn_events ("
        "epoch INTEGER NOT NULL, agent TEXT, approved INTEGER NOT NULL DEFAULT 0);"
    )

    def _spawn_env(self, root: Path) -> dict:
        return {
            **_hook_env(root),
            "SOREN_SESSION": f"soren-sbx-{os.getpid()}",  # nonexistent tmux session
            "SOREN_MAX_SPAWNS_PER_HOUR": "6",
        }

    def test_rate_limit_denies_seventh_spawn(self, sandbox):
        db = _sandbox_db(sandbox)
        now = int(time.time())
        conn = sqlite3.connect(str(db))
        conn.execute(self.SCHEMA)
        conn.executemany(
            "INSERT INTO spawn_events (epoch, agent, approved) VALUES (?, 'x', 0)",
            [(now - 10 * i,) for i in range(1, 7)],  # 6 recent unapproved spawns
        )
        conn.commit()
        conn.close()

        out = subprocess.run(
            ["bash", str(WORKERS), "spawn", "w-limit", "some task"],
            capture_output=True, text=True, cwd=sandbox, env=self._spawn_env(sandbox))
        assert out.returncode != 0
        assert "spawn rate limit" in out.stderr
        # The refused attempt itself is recorded (matches the old ledger)
        rows = _query(db, "SELECT COUNT(*) FROM spawn_events WHERE approved = 0")
        assert rows[0][0] == 7

    def test_user_approved_bypasses_and_is_recorded(self, sandbox):
        db = _sandbox_db(sandbox)
        now = int(time.time())
        conn = sqlite3.connect(str(db))
        conn.execute(self.SCHEMA)
        conn.executemany(
            "INSERT INTO spawn_events (epoch, agent, approved) VALUES (?, 'x', 0)",
            [(now - 10 * i,) for i in range(1, 21)],  # way over the limit
        )
        conn.commit()
        conn.close()

        out = subprocess.run(
            ["bash", str(WORKERS), "spawn", "w-appr", "some task", "--user-approved"],
            capture_output=True, text=True, cwd=sandbox, env=self._spawn_env(sandbox))
        # Fails later (no tmux session in the sandbox) but NOT on the rate limit
        assert "spawn rate limit" not in out.stderr
        rows = _query(db, "SELECT approved FROM spawn_events WHERE agent = 'w-appr'")
        assert rows == [(1,)]

    def test_old_events_pruned(self, sandbox):
        db = _sandbox_db(sandbox)
        now = int(time.time())
        conn = sqlite3.connect(str(db))
        conn.execute(self.SCHEMA)
        conn.execute(
            "INSERT INTO spawn_events (epoch, agent, approved) VALUES (?, 'old', 0)",
            (now - 7200,),  # 2h old — outside the window
        )
        conn.commit()
        conn.close()

        subprocess.run(
            ["bash", str(WORKERS), "spawn", "w-new", "some task"],
            capture_output=True, text=True, cwd=sandbox, env=self._spawn_env(sandbox))
        rows = _query(db, "SELECT agent FROM spawn_events")
        assert ("old",) not in rows
        assert ("w-new",) in rows

    def test_legacy_ledger_file_deleted(self, sandbox):
        ledger = sandbox / ".soren" / "run" / "spawn-events.log"
        ledger.parent.mkdir(parents=True, exist_ok=True)
        ledger.write_text("123\n456\n")
        subprocess.run(
            ["bash", str(WORKERS), "spawn", "w-x", "some task"],
            capture_output=True, text=True, cwd=sandbox, env=self._spawn_env(sandbox))
        assert not ledger.exists()


# ─────────────────────────────────────────────────────────────────────────────
# 5. secrets_vault — roundtrip, concurrency, lazy import
# ─────────────────────────────────────────────────────────────────────────────

class TestSecretsVault:
    def test_set_get_roundtrip(self):
        from src.server.services import secrets as s

        s.set_secret("api_key", "sk-123", "pass1")
        assert s.get_secret("api_key", "pass1") == "sk-123"
        assert s.get_secret("missing", "pass1") is None
        assert s.list_secrets("pass1") == ["api_key"]

        # overwrite
        s.set_secret("api_key", "sk-456", "pass1")
        assert s.get_secret("api_key", "pass1") == "sk-456"

        # delete
        assert s.delete_secret("api_key", "pass1") is True
        assert s.delete_secret("api_key", "pass1") is False
        assert s.list_secrets("pass1") == []

    def test_wrong_passphrase_raises(self):
        from src.server.services import secrets as s

        s.set_secret("k", "v", "right")
        with pytest.raises(ValueError, match="Invalid passphrase"):
            s.get_secret("k", "wrong")
        with pytest.raises(ValueError, match="Invalid passphrase"):
            s.set_secret("k2", "v2", "wrong")

    def test_concurrent_sets_both_survive(self):
        """Two concurrent set_secret calls with different keys — the legacy
        whole-file rewrite lost one; BEGIN IMMEDIATE serializes them."""
        from src.server.services import secrets as s

        s.set_secret("seed", "0", "pw")  # create salt+row up front
        barrier = threading.Barrier(2)
        errors: list[Exception] = []

        def writer(name: str):
            try:
                barrier.wait(timeout=10)
                s.set_secret(name, f"value-{name}", "pw")
            except Exception as e:  # pragma: no cover
                errors.append(e)

        threads = [threading.Thread(target=writer, args=(n,)) for n in ("alpha", "beta")]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        assert not errors
        names = s.list_secrets("pw")
        assert "alpha" in names and "beta" in names, f"lost a secret: {names}"
        assert s.get_secret("alpha", "pw") == "value-alpha"
        assert s.get_secret("beta", "pw") == "value-beta"

    def test_vault_row_is_single(self):
        from src.server.services import secrets as s
        from src.server.services.db import get_db

        s.set_secret("a", "1", "pw")
        s.set_secret("b", "2", "pw")
        with get_db() as conn:
            rows = conn.execute("SELECT id FROM secrets_vault").fetchall()
            assert [r["id"] for r in rows] == [1]
            # CHECK(id=1) rejects any other row
            with pytest.raises(sqlite3.IntegrityError):
                conn.execute(
                    "INSERT INTO secrets_vault (id, salt, blob) VALUES (2, x'00', NULL)")

    def test_legacy_files_imported_once(self):
        from cryptography.fernet import Fernet

        from src.server.services import secrets as s

        # Recreate the legacy on-disk format exactly
        salt = os.urandom(16)
        salt_path = Path(settings.soren_dir) / ".secrets-salt"
        enc_path = Path(settings.soren_dir) / "secrets.enc"
        salt_path.write_bytes(base64.b64encode(salt))
        fernet = Fernet(s._derive_key("legacy-pass", salt))
        enc_path.write_bytes(fernet.encrypt(json.dumps({"old": "gold"}).encode()))

        assert s.get_secret("old", "legacy-pass") == "gold"
        assert not salt_path.exists() and not enc_path.exists()
        assert salt_path.with_name(".secrets-salt.migrated").exists()
        assert enc_path.with_name("secrets.enc.migrated").exists()

        # Same salt still derives the same key: adding a secret keeps the old one
        s.set_secret("new", "shiny", "legacy-pass")
        assert sorted(s.list_secrets("legacy-pass")) == ["new", "old"]