"""Tests for the interactive PTY terminal WebSocket (/api/terminal/ws).

Uses SOREN_TERMINAL_CMD=/bin/cat so tests exercise the PTY bridge without
depending on tmux. Auth setup (temp auth DB + 'testuser') comes from the
autouse fixture in conftest.py.
"""
import json

import pytest
from fastapi import WebSocket
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


def test_terminal_ready_send_failure_does_not_crash_handler(monkeypatch):
    """Regression for the confirmed bug: if the client disconnects in the
    gap between accept() and the server's "ready" frame (PTY spawn takes a
    moment), the resulting send failure must not propagate out of the
    handler as an unhandled ASGI exception
    (``websockets.exceptions.ConnectionClosedError: no close frame received
    or sent``, logged at ERROR by uvicorn) — it must be caught, and cleanup
    (the terminal counter, the PTY child) must still run.
    """
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")

    import src.server.routes.terminal as terminal_module

    async def failing_send_json(self, data):
        raise RuntimeError("simulated: no close frame received or sent")

    monkeypatch.setattr(WebSocket, "send_json", failing_send_json)

    assert terminal_module._active_terminals == 0
    client = TestClient(app)
    # The regression being guarded against is a server-side crash (an
    # unhandled exception propagating out of the ASGI app) — the important
    # assertion is that opening and immediately exiting the connection
    # completes without raising at all, and that cleanup still ran (no
    # leaked "active terminal" slot from skipping straight to `finally`).
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}"):
        pass

    assert terminal_module._active_terminals == 0


def test_terminal_pong_send_failure_does_not_crash_handler(monkeypatch):
    """Same failure class as above, but for the pong reply in _client_loop
    (also previously unwrapped) rather than the initial ready frame."""
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")

    import src.server.routes.terminal as terminal_module

    original_send_json = WebSocket.send_json
    call_count = 0

    async def fail_after_ready(self, data):
        nonlocal call_count
        call_count += 1
        if data.get("type") == "pong":
            raise RuntimeError("simulated: no close frame received or sent")
        return await original_send_json(self, data)

    monkeypatch.setattr(WebSocket, "send_json", fail_after_ready)

    client = TestClient(app)
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws:
        assert ws.receive_json()["type"] == "ready"
        # The failing pong send must not kill the connection outright —
        # the PTY output path (_pump_output, on a separate send_lock-guarded
        # call) keeps working afterward.
        ws.send_text(json.dumps({"type": "ping"}))
        ws.send_text(json.dumps({"type": "input", "data": "hi\n"}))
        buffer = ""
        for _ in range(20):
            frame = ws.receive_json()
            if frame["type"] == "output":
                buffer += frame["data"]
                if "hi" in buffer:
                    break
    assert "hi" in buffer
    assert terminal_module._active_terminals == 0


def test_terminal_concurrent_output_and_pong_do_not_interleave(monkeypatch):
    """The send_lock shared between _pump_output and _client_loop's pong
    reply must serialize sends on the same connection — verified indirectly
    by flooding both paths at once and asserting every received frame is
    still valid, complete JSON (an unserialized interleave would corrupt a
    frame boundary and produce a JSONDecodeError on the client)."""
    monkeypatch.setenv("SOREN_TERMINAL_CMD", "/bin/cat")
    client = TestClient(app)
    with client.websocket_connect(f"/api/terminal/ws?token={_token()}") as ws:
        assert ws.receive_json()["type"] == "ready"
        # Interleave a burst of input (drives _pump_output via PTY echo)
        # with a burst of pings (drives _client_loop's pong send) so both
        # tasks are racing to send on the same websocket.
        for i in range(15):
            ws.send_text(json.dumps({"type": "input", "data": f"{i}\n"}))
            ws.send_text(json.dumps({"type": "ping"}))

        seen_pongs = 0
        frames_checked = 0
        while frames_checked < 60 and seen_pongs < 15:
            raw = ws.receive_text()
            frame = json.loads(raw)  # raises if a frame got corrupted
            assert frame["type"] in ("output", "pong")
            if frame["type"] == "pong":
                seen_pongs += 1
            frames_checked += 1
        assert seen_pongs == 15
