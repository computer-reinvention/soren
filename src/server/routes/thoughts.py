from fastapi import APIRouter, Query
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
import hashlib
import logging
import time
import uuid

from ..websocket.manager import ws_manager
from ..services.conversation_store import conversation_store

logger = logging.getLogger(__name__)

router = APIRouter()

# Content-based dedup cache: hash(agent_name + content) -> (thought_id, timestamp)
_recent_thoughts: dict[str, tuple[str, float]] = {}
_dedup_request_count = 0
_DEDUP_WINDOW_SECONDS = 30
_DEDUP_CLEANUP_INTERVAL = 100


class ThoughtEvent(BaseModel):
    agent_name: str
    thought_type: str  # 'reasoning' or 'tool_result'
    content: Optional[str] = None
    tool_name: Optional[str] = None
    tool_input: Optional[str] = None
    tool_response: Optional[str] = None
    timestamp: Optional[str] = None


def _dedup_key(agent_name: str, content: Optional[str]) -> str:
    raw = f"{agent_name}:{content or ''}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _cleanup_expired():
    global _recent_thoughts
    now = time.monotonic()
    _recent_thoughts = {
        k: v for k, v in _recent_thoughts.items()
        if now - v[1] < _DEDUP_WINDOW_SECONDS
    }


@router.post("")
async def receive_thought(event: ThoughtEvent):
    """
    Receive a live thought/reasoning event from a Claude Code hook.

    Persists to SQLite and broadcasts via WebSocket.
    Deduplicates identical thoughts from the same agent within a 30s window.
    """
    global _dedup_request_count

    _dedup_request_count += 1
    if _dedup_request_count % _DEDUP_CLEANUP_INTERVAL == 0:
        _cleanup_expired()

    now = time.monotonic()
    key = _dedup_key(event.agent_name, event.content)

    if key in _recent_thoughts:
        existing_id, ts = _recent_thoughts[key]
        if now - ts < _DEDUP_WINDOW_SECONDS:
            return {"success": True, "thought_id": existing_id, "deduplicated": True}

    thought_id = str(uuid.uuid4())[:8]
    _recent_thoughts[key] = (thought_id, now)

    thought_data = {
        "id": thought_id,
        "agent_name": event.agent_name,
        "thought_type": event.thought_type,
        "content": event.content,
        "tool_name": event.tool_name,
        "tool_input": _truncate(event.tool_input, 500),
        "tool_response": _truncate(event.tool_response, 500),
        "timestamp": event.timestamp or datetime.now(timezone.utc).isoformat(),
    }

    conversation_store.store_thought(thought_data)
    await ws_manager.broadcast("agent_thought", thought_data)

    return {"success": True, "thought_id": thought_id}


@router.get("")
async def get_thoughts(
    agent_name: Optional[str] = Query(None, description="Filter by agent name"),
    limit: int = Query(50, ge=1, le=500, description="Max number of thoughts to return"),
):
    """Retrieve persisted thoughts, optionally filtered by agent name."""
    thoughts = conversation_store.get_thoughts(agent_name=agent_name, limit=limit)
    return {"thoughts": thoughts, "count": len(thoughts)}


def _truncate(text: Optional[str], max_length: int) -> Optional[str]:
    if text is None:
        return None
    if len(text) > max_length:
        return text[:max_length] + "..."
    return text
