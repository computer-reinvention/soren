"""Tests for the interactive PTY terminal WebSocket (/api/terminal/ws).

Uses SOREN_TERMINAL_CMD=/bin/cat so tests exercise the PTY bridge without
depending on tmux. Auth setup (temp auth DB + 'testuser') comes from the
autouse fixture in conftest.py.
"""
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import src.server.services.auth as auth_module
from src.server.config import settings
from src.server.main import app


def _token() -> str:
    return auth_module.create_token("testuser")


def test_terminal_rejects_missing_token():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/terminal/ws"):
            pass
    assert exc_info.value.code == 4401


def test_terminal_rejects_invalid_token():
    client = TestClient(app)
    with pytest.raises(WebSocketDisconnect) as exc_info:
        with client.websocket_connect("/api/terminal/ws?token=not-a-valid-jwt"):
            pass
    assert exc_info.value.code == 4401


def test_terminal_echo_resize_and_clean_close(monkeypatch):
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")
    client = TestClient(app)
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws:
        ready = ws.receive_json()
        assert ready == {"type": "ready", "mode": "shell"}

        # cat echoes stdin (plus the pty line discipline echoes the input)
        ws.send_text(json.dumps({"type": "input", "data": "hello\n"}))
        buffer = ""
        for _ in range(20):
            frame = ws.receive_json()
            assert frame["type"] == "output"
            buffer += frame["data"]
            if "hello" in buffer:
                break
        assert "hello" in buffer

        # Resize must not error; a ping/pong round-trip proves the
        # connection survived the ioctl.
        ws.send_text(json.dumps({"type": "resize", "cols": 120, "rows": 40}))
        ws.send_text(json.dumps({"type": "ping"}))
        for _ in range(20):
            frame = ws.receive_json()
            if frame["type"] == "pong":
                break
            assert frame["type"] == "output"
        else:
            pytest.fail("no pong received after resize")
    # Context-manager exit closes the socket; server tears down the PTY.


def test_terminal_ignores_malformed_frames(monkeypatch):
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")
    client = TestClient(app)
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws:
        assert ws.receive_json()["type"] == "ready"
        ws.send_text("this is not json")
        ws.send_text(json.dumps({"type": "resize", "cols": "bogus", "rows": None}))
        ws.send_text(json.dumps({"type": "ping"}))
        assert ws.receive_json() == {"type": "pong"}


def test_terminal_rejects_unknown_mode():
    client = TestClient(app)
    with client.websocket_connect(
        f"/api/terminal/ws?token={_token()}&mode=evil"
    ) as ws:
        frame = ws.receive_json()
        assert frame["type"] == "error"
        assert "unknown mode" in frame["message"]


def test_terminal_soren_mode_requires_session(monkeypatch):
    # Point at a session name that cannot exist; no SOREN_TERMINAL_CMD
    # override so the tmux existence check runs.
    monkeypatch.delenv("SOREN_TERMINAL_CMD", raising=False)
    monkeypatch.setattr(settings, "tmux_session", "soren-test-nonexistent-a7f3")
    client = TestClient(app)
    with client.websocket_connect(
        f"/api/terminal/ws?token={_token()}&mode=soren"
    ) as ws:
        frame = ws.receive_json()
        assert frame["type"] == "error"
        assert "is not running" in frame["message"]


def test_terminal_over_capacity(monkeypatch):
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")
    monkeypatch.setenv("SOREN_TERMINAL_MAX", "1")
    client = TestClient(app)
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws1:
        # First terminal fully up (counter incremented before ready is sent)
        assert ws1.receive_json()["type"] == "ready"
        with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws2:
            frame = ws2.receive_json()
            assert frame["type"] == "error"
            assert "too many concurrent terminals" in frame["message"]
