"""Shared WebSocket authentication and Origin checking.

FastAPI's ``@app.middleware("http")`` only runs for the ``http`` ASGI scope —
it NEVER executes for ``websocket`` connections, so the token check in
``main.py`` cannot protect WS endpoints. Every WebSocket route must therefore
authenticate in-handler via :func:`authenticate_ws` BEFORE calling
``websocket.accept()``.

Used by ``routes/agents.py`` (/api/agents/ws) and ``routes/terminal.py``
(/api/terminal/ws).
"""
import logging
import os
from urllib.parse import urlparse

from fastapi import WebSocket

from .auth import decode_token

logger = logging.getLogger(__name__)

# Application close code for failed WS authentication (4000-4999 is the
# private-use range; mirrors HTTP 401).
WS_CLOSE_UNAUTHORIZED = 4401

# Hosts always considered local/trusted regardless of port
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _hostname(value: str | None) -> str | None:
    """Extract a lowercase hostname from a URL or bare ``host[:port]`` string.

    Handles ``https://foo.bar:8443``, ``foo.bar:8000`` and ``[::1]:8000``.
    """
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    if "//" not in value:
        value = f"//{value}"
    try:
        host = urlparse(value).hostname
    except ValueError:
        return None
    return host.lower() if host else None


def origin_allowed(websocket: WebSocket) -> bool:
    """Return True if the connection's Origin header is acceptable.

    Policy:
    - No Origin header (non-browser clients: tests, CLIs) -> allow; the JWT
      check is the actual identity gate.
    - Origin host matching the request Host header (ignoring ports) -> allow.
    - localhost / 127.0.0.1 / ::1 (any port) -> allow.
    - Any ``*.ts.net`` host (Tailscale MagicDNS) -> allow.
    - Entries from ``SOREN_WS_EXTRA_ORIGINS`` (comma-separated; full origins
      or bare hosts) -> allow.
    """
    origin = websocket.headers.get("origin")
    if not origin:
        return True

    host = _hostname(origin)
    if not host:
        return False

    if host in _LOCAL_HOSTS:
        return True
    if host.endswith(".ts.net"):
        return True

    request_host = _hostname(websocket.headers.get("host"))
    if request_host and host == request_host:
        return True

    for entry in os.environ.get("SOREN_WS_EXTRA_ORIGINS", "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        if entry == origin or _hostname(entry) == host:
            return True

    return False


async def authenticate_ws(websocket: WebSocket) -> str | None:
    """Validate Origin + JWT for a WebSocket connection.

    Must be called BEFORE ``websocket.accept()``. Returns the authenticated
    username, or ``None`` after closing the socket with code 4401. Starlette
    permits close-before-accept: the ASGI server denies the handshake with an
    HTTP 403 and the close code is surfaced to test clients.

    Token sources: ``?token=`` query param (the frontend appends this, see
    src/frontend/src/hooks/useWebSocket.ts), falling back to the
    ``soren_token`` cookie.
    """
    if not origin_allowed(websocket):
        logger.warning(
            "WS rejected: disallowed origin %r for %s",
            websocket.headers.get("origin"),
            websocket.url.path,
        )
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return None

    token = websocket.query_params.get("token") or websocket.cookies.get("soren_token")
    username = decode_token(token) if token else None
    if not username:
        logger.info("WS rejected: missing or invalid token for %s", websocket.url.path)
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return None

    return username
