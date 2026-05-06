from fastapi import WebSocket
from typing import Dict, Optional
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
        self._lock = asyncio.Lock()
        self._ping_task: Optional[asyncio.Task] = None

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        async with self._lock:
            self.active_connections[client_id] = websocket
        logger.info(f"WebSocket client connected: {client_id}")

    async def disconnect(self, client_id: str):
        async with self._lock:
            if client_id in self.active_connections:
                del self.active_connections[client_id]
        logger.info(f"WebSocket client disconnected: {client_id}")

    async def disconnect_all(self):
        async with self._lock:
            for client_id, ws in self.active_connections.items():
                try:
                    await ws.close()
                except Exception as e:
                    logger.warning(f"Error closing WebSocket for {client_id}: {e}")
            self.active_connections.clear()
        logger.info("All WebSocket connections closed")

    async def broadcast(self, event: str, data: dict):
        message = json.dumps(
            {
                "event": event,
                "data": data,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        async with self._lock:
            disconnected = []
            for client_id, connection in self.active_connections.items():
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.warning(
                        f"Failed to send to {client_id}, marking for disconnect: {e}"
                    )
                    disconnected.append(client_id)
            for client_id in disconnected:
                del self.active_connections[client_id]
                logger.info(f"Removed stale connection: {client_id}")

    async def send_to(self, client_id: str, event: str, data: dict):
        if client_id in self.active_connections:
            message = json.dumps(
                {
                    "event": event,
                    "data": data,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            )
            try:
                await self.active_connections[client_id].send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to {client_id}: {e}")
                async with self._lock:
                    if client_id in self.active_connections:
                        del self.active_connections[client_id]
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
        async with self._lock:
            disconnected = []
            connection_count = len(self.active_connections)
            if connection_count > 0:
                logger.debug(f"Sending ping to {connection_count} clients")
            for client_id, connection in self.active_connections.items():
                try:
                    await connection.send_text(message)
                except Exception as e:
                    logger.warning(f"Ping failed for {client_id}: {e}")
                    disconnected.append(client_id)
            for client_id in disconnected:
                del self.active_connections[client_id]
                logger.info(f"Removed dead connection after ping failure: {client_id}")

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
