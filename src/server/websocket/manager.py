from fastapi import WebSocket
from typing import Dict, List, Optional, Tuple
import asyncio
import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Ping interval in seconds
PING_INTERVAL = 30


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        # Guards active_connections/_send_locks dict mutation only — never
        # held across a `send_text()` call (see _send_one).
        self._lock = asyncio.Lock()
        # Per-connection send lock. WebSocket.send_text() must never be
        # called concurrently on the SAME connection (Starlette/ASGI
        # disallows overlapping sends on one socket and can corrupt the
        # frame if you do), but two DIFFERENT connections should never
        # have to wait on each other. Previously broadcast()/_send_ping()
        # held one global lock for the entire fan-out loop and sent to
        # every client sequentially inside it — a single slow or
        # backpressured client serialized delivery to every other client
        # for that whole broadcast, and also blocked connect()/
        # disconnect() from even acquiring the lock in the meantime.
        self._send_locks: Dict[str, asyncio.Lock] = {}
        self._ping_task: Optional[asyncio.Task] = None

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        async with self._lock:
            self.active_connections[client_id] = websocket
            self._send_locks[client_id] = asyncio.Lock()
        logger.info(f"WebSocket client connected: {client_id}")

    async def disconnect(self, client_id: str):
        async with self._lock:
            self.active_connections.pop(client_id, None)
            self._send_locks.pop(client_id, None)
        logger.info(f"WebSocket client disconnected: {client_id}")

    async def disconnect_all(self):
        async with self._lock:
            for client_id, ws in self.active_connections.items():
                try:
                    await ws.close()
                except Exception as e:
                    logger.warning(f"Error closing WebSocket for {client_id}: {e}")
            self.active_connections.clear()
            self._send_locks.clear()
        logger.info("All WebSocket connections closed")

    async def _send_one(self, client_id: str, connection: WebSocket, message: str) -> bool:
        """Send `message` to a single connection.

        Serialized against any other concurrent send to that SAME
        connection (a broadcast and the ping loop can legitimately
        overlap), via a lock scoped to just this client_id — never the
        shared self._lock, so this can run fully in parallel with sends
        to every other connection. Returns True on success, False if the
        send failed (caller is responsible for removing the connection).
        """
        lock = self._send_locks.get(client_id)
        if lock is None:
            # Connection was removed by another task between snapshot and
            # send (e.g. disconnected concurrently) — nothing to do.
            return False
        async with lock:
            try:
                await connection.send_text(message)
                return True
            except Exception as e:
                logger.warning(
                    f"Failed to send to {client_id}, marking for disconnect: {e}"
                )
                return False

    async def _fanout(self, message: str) -> None:
        """Send `message` to every currently-connected client concurrently
        and prune any that failed. Shared implementation for broadcast()
        and _send_ping() — both need the exact same snapshot-release-
        gather-prune pattern.
        """
        async with self._lock:
            # Snapshot and release immediately — the actual sends below
            # must never happen while holding this lock, or a single slow
            # client would block every other client's delivery for this
            # call AND block connect()/disconnect() from progressing.
            targets: List[Tuple[str, WebSocket]] = list(self.active_connections.items())

        if not targets:
            return

        results = await asyncio.gather(
            *(self._send_one(client_id, connection, message) for client_id, connection in targets)
        )

        disconnected = [client_id for (client_id, _), ok in zip(targets, results) if not ok]
        if disconnected:
            async with self._lock:
                for client_id in disconnected:
                    self.active_connections.pop(client_id, None)
                    self._send_locks.pop(client_id, None)
                    logger.info(f"Removed stale connection: {client_id}")

    async def broadcast(self, event: str, data: dict):
        message = json.dumps(
            {
                "event": event,
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        await self._fanout(message)

    async def send_to(self, client_id: str, event: str, data: dict):
        async with self._lock:
            connection = self.active_connections.get(client_id)
        if connection is None:
            return
        message = json.dumps(
            {
                "event": event,
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        ok = await self._send_one(client_id, connection, message)
        if not ok:
            async with self._lock:
                self.active_connections.pop(client_id, None)
                self._send_locks.pop(client_id, None)
                logger.info(f"Removed stale connection: {client_id}")

    async def _ping_loop(self):
        """Send periodic ping messages to all connected clients."""
        logger.info("WebSocket ping loop started")
        while True:
            try:
                await asyncio.sleep(PING_INTERVAL)
                await self._send_ping()
            except asyncio.CancelledError:
                logger.info("WebSocket ping loop cancelled")
                break
            except Exception as e:
                logger.error(f"Error in ping loop: {e}")

    async def _send_ping(self):
        """Send ping to all connections and clean up dead ones."""
        message = json.dumps(
            {
                "event": "ping",
                "data": {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        connection_count = len(self.active_connections)
        if connection_count > 0:
            logger.debug(f"Sending ping to {connection_count} clients")
        await self._fanout(message)

    def start_ping_task(self):
        """Start the background ping task."""
        if self._ping_task is None or self._ping_task.done():
            self._ping_task = asyncio.create_task(self._ping_loop())
            logger.info("Started WebSocket ping task")

    async def stop_ping_task(self):
        """Stop the background ping task."""
        if self._ping_task and not self._ping_task.done():
            self._ping_task.cancel()
            try:
                await self._ping_task
            except asyncio.CancelledError:
                pass
            logger.info("Stopped WebSocket ping task")


ws_manager = ConnectionManager()
