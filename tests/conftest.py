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
    """Redirect ALL persistent stores to temp directory during tests.

    Prevents test data from polluting production databases
    (conversations.db, memories.db, agent_registry.db).
    """
    original_path = settings.mailbox_path
    original_soren_dir = settings.soren_dir

    # Set up temp paths
    test_soren_dir = tmp_path / ".soren"
    test_soren_dir.mkdir(parents=True, exist_ok=True)
    test_mailbox = test_soren_dir / "mailbox"

    # Override settings
    settings.soren_dir = test_soren_dir
    settings.mailbox_path = test_mailbox

    # Also update the mailbox service instance
    mailbox_service.mailbox_path = test_mailbox

    # --- Conversation store: redirect to temp DB ---
    original_conv_db = conversation_store.db_path
    conversation_store.db_path = test_soren_dir / "conversations.db"
    conversation_store._ensure_db()
    _ensure_failure_table()  # failure_log lives in same DB, needed by verify-result

    # --- Memory store: redirect to temp DB ---
    original_mem_db = memory_store.db_path
    memory_store.db_path = test_soren_dir / "memories.db"
    memory_store._ensure_db()

    # --- Agent registry: redirect DB and JSON cache to temp ---
    monkeypatch.setattr(registry_module, "DB_PATH", test_soren_dir / "agent_registry.db")
    monkeypatch.setattr(registry_module, "JSON_CACHE_PATH", test_soren_dir / "agent_registry.json")

    # Redirect auth DB and secret to temp directory
    monkeypatch.setattr(auth_module, "AUTH_DB_PATH", test_soren_dir / "auth.db")
    monkeypatch.setattr(auth_module, "AUTH_SECRET_PATH", test_soren_dir / ".auth-secret")

    # Initialise auth DB and create a test user
    auth_module.init_db()
    auth_module.add_user("testuser", "testpass")

    yield

    # Restore original paths
    settings.mailbox_path = original_path
    settings.soren_dir = original_soren_dir
    mailbox_service.mailbox_path = original_path
    conversation_store.db_path = original_conv_db
    memory_store.db_path = original_mem_db


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
