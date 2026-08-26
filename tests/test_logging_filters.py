"""Tests for the benign-keepalive-ping log filter (see main.py).

A client silently disconnecting (backgrounded tab, phone locked) makes the
server's periodic WebSocket keepalive ping time out, which the
``websockets`` library logs at ERROR with a full traceback even though
websocket/manager.py already handles that exact disconnect gracefully.
This filter suppresses only that one specific, harmless pattern.
"""
import logging

from src.server.main import _BenignKeepaliveFilter


def _record(message: str) -> logging.LogRecord:
    return logging.LogRecord(
        name="uvicorn.error",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg=message,
        args=None,
        exc_info=None,
    )


def test_filters_out_keepalive_ping_failed():
    assert _BenignKeepaliveFilter().filter(_record("keepalive ping failed")) is False


def test_filters_out_keepalive_ping_timeout():
    assert _BenignKeepaliveFilter().filter(_record("keepalive ping timeout")) is False


def test_does_not_filter_unrelated_data_transfer_failure():
    """"data transfer failed" is the library's catch-all for genuinely
    unexpected exceptions -- must never be suppressed, even though it comes
    from the same library and can be logged around the same time."""
    assert _BenignKeepaliveFilter().filter(_record("data transfer failed")) is True


def test_does_not_filter_unrelated_messages():
    assert _BenignKeepaliveFilter().filter(_record("Exception in ASGI application")) is True
    assert _BenignKeepaliveFilter().filter(_record("some other real error")) is True


def test_filter_is_attached_to_uvicorn_error_logger():
    filters = logging.getLogger("uvicorn.error").filters
    assert any(isinstance(f, _BenignKeepaliveFilter) for f in filters)
