import pytest
from fastapi.testclient import TestClient
from httpx import AsyncClient, ASGITransport
import pytest_asyncio
from pathlib import Path
import src.server.services.auth as auth_module

from src.server.main import app
from src.server.config import settings
from src.server.services.mailbox import mailbox_service
from src.server.services.conversation_store import conversation_store
from src.server.services.memory_store import memory_store
import src.server.services.agent_registry as registry_module
from src.server.services.failure_log import _ensure_table as _ensure_failure_table


@pytest.fixture(autouse=True)
def setup_test_environment(tmp_path, monkeypatch):
    """Redirect ALL persistent stores to a temp consolidated DB during tests.

    Everything lands in one file — <tmp>/.soren/soren.db — mirroring the
    production layout, and preventing test data from polluting the real
    .soren/soren.db.
    """
    original_path = settings.mailbox_path
    original_soren_dir = settings.soren_dir
    original_db_path = settings.db_path

    # Set up temp paths
    test_soren_dir = tmp_path / ".soren"
    test_soren_dir.mkdir(parents=True, exist_ok=True)
    test_mailbox = test_soren_dir / "mailbox"
    test_db = test_soren_dir / "soren.db"

    # Override settings — services resolve the DB path dynamically via
    # services/db.py:get_db_path(), so this redirects every per-call consumer
    # (auth, tasks routes, heartbeat, task_dag, blocker_detector, quality, ...)
    settings.soren_dir = test_soren_dir
    settings.mailbox_path = test_mailbox
    settings.db_path = test_db

    # Also update the mailbox service instance
    mailbox_service.mailbox_path = test_mailbox

    # --- Conversation store: redirect instance to the temp consolidated DB ---
    original_conv_db = conversation_store.db_path
    conversation_store.db_path = test_db
    conversation_store._ensure_db()
    _ensure_failure_table()  # failure_log lives in same DB, needed by verify-result

    # --- Memory store: redirect instance to the temp consolidated DB ---
    original_mem_db = memory_store.db_path
    memory_store.db_path = test_db
    memory_store._ensure_db()

    # --- Agent registry: reconnect the persistent connection to the temp DB ---
    monkeypatch.setattr(registry_module, "JSON_CACHE_PATH", test_soren_dir / "agent_registry.json")
    registry_module.agent_registry.reconnect(test_db)

    # Redirect auth secret to temp directory (users table follows settings.db_path)
    monkeypatch.setattr(auth_module, "AUTH_SECRET_PATH", test_soren_dir / ".auth-secret")

    # Initialise auth DB and create a test user
    auth_module.init_db()
    auth_module.add_user("testuser", "testpass")

    # Point real-cost lookups (services/opencode_transcripts.py) at a path
    # guaranteed not to exist rather than the host machine's real
    # ~/.local/share/opencode/opencode.db. Collision with a real session id
    # is effectively impossible (opencode's ids are random ses_* strings,
    # tests use plain names like "sess-bg-1"), but this makes the
    # estimate-fallback behavior hermetic instead of incidentally true —
    # tests must not depend on what happens to be on the machine running them.
    monkeypatch.setenv(
        "SOREN_OPENCODE_DB_PATH", str(test_soren_dir / "opencode-does-not-exist.db")
    )

    yield

    # Restore original paths
    settings.mailbox_path = original_path
    settings.soren_dir = original_soren_dir
    settings.db_path = original_db_path
    mailbox_service.mailbox_path = original_path
    conversation_store.db_path = original_conv_db
    memory_store.db_path = original_mem_db
    registry_module.agent_registry.reconnect()


def _auth_headers() -> dict:
    """Return Authorization header with a valid JWT token for 'testuser'."""
    token = auth_module.create_token("testuser")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def client():
    return TestClient(app, headers=_auth_headers())


@pytest_asyncio.fixture
async def async_client():
    transport = ASGITransport(app=app)
    headers = _auth_headers()
    async with AsyncClient(transport=transport, base_url="http://test", headers=headers) as ac:
        yield ac
