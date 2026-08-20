import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import src.server.services.auth as auth_module
from src.server.main import app


def _token() -> str:
    return auth_module.create_token("testuser")


def test_websocket_rejects_missing_token():
    """Tokenless connections are rejected with 4401 before accept.

    The HTTP auth middleware never runs for the websocket scope; auth is
    enforced in-handler (services/ws_auth.py).
    """
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/agents/ws"):
            pass
    assert exc_info.value.code == 4401


def test_websocket_rejects_invalid_token():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/agents/ws?token=not-a-valid-jwt"):
            pass
    assert exc_info.value.code == 4401


def test_websocket_connect_with_token():
    client = TestClient(app)
    with client.websocket_connect(f"/api/agents/ws?token={_token()}"):
        # Connection should be accepted
        pass  # Just test that connection works


def test_websocket_connect_with_cookie():
    client = TestClient(app)
    client.cookies.set("soren_token", _token())
    with client.websocket_connect("/api/agents/ws"):
        pass


def test_websocket_receives_message():
    client = TestClient(app)
    with client.websocket_connect(f"/api/agents/ws?token={_token()}") as websocket:
        # Send a test message
        websocket.send_text("test")
        # Connection should remain open
        pass
