import pytest
from fastapi.testclient import TestClient

from src.server.main import app


def test_websocket_connect():
    client = TestClient(app)
    with client.websocket_connect("/api/agents/ws") as websocket:
        # Connection should be accepted
        pass  # Just test that connection works


def test_websocket_receives_message():
    client = TestClient(app)
    with client.websocket_connect("/api/agents/ws") as websocket:
        # Send a test message
        websocket.send_text("test")
        # Connection should remain open
        pass
