from fastapi import APIRouter
from datetime import datetime, timezone
from typing import Any
import asyncio
import json
import os
import time
import uuid
import logging
from pathlib import Path

from ..config import settings
from ..models.agent import AgentStatus
from ..models.agent_event import AgentEvent, AgentEventResponse, AgentEventType
from ..models.message import Message, MessageType
from ..services.agent_manager import agent_manager
from ..services.agent_registry import agent_registry
from ..services.conversation_store import conversation_store
from ..services.db import get_db
from ..services.mailbox import mailbox_service
from ..services.tmux_service import tmux_service
from ..websocket.manager import ws_manager

logger = logging.getLogger(__name__)

# ── Compaction configuration ────────────────────────────────────────────────
_CONTEXT_WINDOW = int(os.environ.get("SOREN_CONTEXT_WINDOW", "200000"))
_COMPACT_THRESHOLD = float(os.environ.get("SOREN_COMPACT_THRESHOLD", "0.80"))
_COMPACT_COOLDOWN = int(os.environ.get("SOREN_COMPACT_COOLDOWN", "1800"))
_RECOVERY_DELAY = 5  # seconds after /compact before injecting recovery message
_COMPACT_EFFECTIVENESS_FILE = Path(".soren/.compact-effectiveness")
# Track agents with pending compaction — maps agent_id → pre_tokens (input_tokens)
_pending_compactions: dict[str, int] = {}

# Laminar trace context (optional — noop if not initialized)
try:
    from lmnr import Laminar as _Laminar
    _lmnr_available = _Laminar.is_initialized()
except Exception:
    _lmnr_available = False

router = APIRouter()


@router.post("", response_model=AgentEventResponse)
async def receive_agent_event(event: AgentEvent):
    """
    Receive events from the soren-bridge opencode plugin.

    This endpoint is called by the plugin when:
    - PostToolUse: After a tool (Bash, Write, Edit, Read) is executed
    - Stop: When the agent completes a response

    Events are persisted to SQLite. On Stop events, all preceding unlinked
    tool calls for the agent are linked to the resulting message via message_id.
    """
    event_id = str(uuid.uuid4())[:8]

    # Use agent_id if available, fallback to session_id
    display_agent_id = event.agent_id if event.agent_id and event.agent_id != "unknown" else event.session_id

    # Set Laminar trace metadata so traces are grouped per agent
    if _lmnr_available:
        try:
            _Laminar.set_trace_metadata({
                "agent_id": display_agent_id,
                "event_type": event.event_type.value,
                "session_id": event.session_id,
            })
        except Exception:
            pass  # Observability must never break event handling

    # Build event data
    event_data = {
        "id": event_id,
        "event_type": event.event_type.value,
        "session_id": event.session_id,
        "agent_id": display_agent_id,
        "tool_name": event.tool_name,
        "tool_input": _truncate_content(event.tool_input),
        "tool_output": _truncate_content(event.tool_output),
        "timestamp": event.timestamp.isoformat(),
        "message_id": None,
        "usage": event.usage,
    }

    # Persist to SQLite
    conversation_store.store_event(event_data)

    # Track compaction effectiveness: if this agent had a pending compaction,
    # record the post-compaction token count
    if (event.event_type == AgentEventType.STOP
            and display_agent_id in _pending_compactions
            and event.usage):
        pre_tokens = _pending_compactions.pop(display_agent_id)
        post_tokens = int(event.usage.get("input_tokens", 0) or 0)
        _record_compaction_effectiveness(display_agent_id, pre_tokens, post_tokens)

    # Event-driven compaction: check context usage on every Stop event
    asyncio.create_task(_maybe_compact_agent(event, display_agent_id))

    # Broadcast agent_event to WebSocket clients
    await ws_manager.broadcast("agent_event", event_data)

    # Update agent status and last_activity based on event type.
    # PostToolUse → IN_PROGRESS (agent is actively working)
    # Stop → IDLE (agent finished responding)
    # UserPromptSubmit → IN_PROGRESS (agent received input)
    if event.event_type in (AgentEventType.POST_TOOL_USE, AgentEventType.USER_PROMPT_SUBMIT):
        new_status = AgentStatus.IN_PROGRESS
    elif event.event_type == AgentEventType.STOP:
        new_status = AgentStatus.IDLE
    else:
        new_status = None

    if new_status:
        agent = await agent_manager.update_agent_status(display_agent_id, new_status)
        if agent:
            await ws_manager.broadcast("agent_status", {
                "agent_id": display_agent_id,
                "status": new_status.value,
                "last_activity": agent.last_activity.isoformat() if agent.last_activity else None,
            })

    # For Stop events with response_content, create a message and broadcast it
    if event.event_type == AgentEventType.STOP and event.response_content:
        response_content = event.response_content
        msg_type = MessageType.RESPONSE

        # Detect [SYS] tagged messages — agents prefix system-level responses
        # (heartbeat acks, compaction recovery, idle status) with [SYS]
        if response_content.strip().startswith("[SYS]"):
            msg_type = MessageType.SYSTEM
            response_content = response_content.strip().removeprefix("[SYS]").strip()

        # Skip internal verification messages that leak through agent responses.
        # When an agent receives [COMMIT-CHECK], [FIX-REQUEST], etc. in its tmux
        # window and responds, the response_content can be the verification message
        # itself. These should never appear on the user dashboard.
        _INTERNAL_TAGS = (
            "[COMMIT-CHECK]", "[VERIFY-WARN]", "[VERIFY-FAILED]",
            "[FIX-REQUEST]", "[UI-CHECK]",
        )
        _content_stripped = response_content.strip()

        # Supervisors may also deliver replies via the mailbox pipeline.
        # Direct TUI responses must still stream to the dashboard, so instead
        # of skipping supervisors entirely (which silenced their chat replies)
        # we only skip when an identical message was already stored recently
        # (mailbox + Stop double-delivery guard).
        _is_duplicate = False
        if display_agent_id == "supervisor" or display_agent_id.startswith("sup-"):
            try:
                recent = await mailbox_service.get_messages(
                    limit=20, agent_id=display_agent_id
                )
                _now = datetime.now(timezone.utc)
                for _m in recent:
                    _ts = _m.timestamp
                    if _ts.tzinfo is None:
                        _ts = _ts.replace(tzinfo=timezone.utc)
                    if (_now - _ts).total_seconds() > 180:
                        continue
                    if (
                        _m.from_agent == display_agent_id
                        and _m.content.strip() == _content_stripped
                    ):
                        _is_duplicate = True
                        break
            except Exception as exc:
                logger.debug(f"Supervisor dedup check failed (storing anyway): {exc}")

        if any(_content_stripped.startswith(tag) for tag in _INTERNAL_TAGS):
            logger.debug(
                f"Skipping internal verification response from {display_agent_id}: "
                f"{_content_stripped[:60]}"
            )
        elif _is_duplicate:
            logger.debug(
                f"Skipping Stop-event message store for {display_agent_id} "
                f"(identical message already delivered via mailbox)"
            )
        else:
            msg = Message(
                id=str(uuid.uuid4()),
                timestamp=datetime.now(timezone.utc),
                from_agent=display_agent_id,
                to_agent="user",
                type=msg_type,
                content=response_content,
            )
            # Store in mailbox service for retrieval via /api/messages
            mailbox_service.store_message(msg)

            # Link all unlinked tool call events for this agent to this message
            linked = conversation_store.link_events_to_message(display_agent_id, msg.id)
            logger.debug(f"Linked {linked} tool call events to message {msg.id}")

            # Broadcast to frontend so it appears in the chat
            await ws_manager.broadcast("new_message", msg.model_dump(mode="json"))

    return AgentEventResponse(
        success=True,
        event_id=event_id,
        message=f"Event {event.event_type.value} received for agent {display_agent_id}",
    )


@router.get("")
async def list_agent_events(
    session_id: str | None = None,
    agent_id: str | None = None,
    limit: int = 50,
):
    """
    List recent agent events from SQLite.

    Args:
        session_id: Filter by session ID (optional)
        agent_id: Filter by agent ID (optional)
        limit: Maximum number of events to return
    """
    events = conversation_store.get_events(
        session_id=session_id,
        agent_id=agent_id,
        limit=limit,
    )
    return {"events": events, "total": len(events)}


@router.get("/by-message/{message_id}")
async def get_events_by_message(message_id: str):
    """Get all agent events (tool calls) linked to a specific message."""
    events = conversation_store.get_events_by_message(message_id)
    return {"events": events, "total": len(events)}


@router.post("/by-messages")
async def get_events_by_messages(payload: dict):
    """Get agent events for multiple messages at once.

    Expects: {"message_ids": ["id1", "id2", ...]}
    Returns: {"events_by_message": {"id1": [...], "id2": [...]}}
    """
    message_ids = payload.get("message_ids", [])
    result: dict[str, list] = {}
    for mid in message_ids:
        result[mid] = conversation_store.get_events_by_message(mid)
    return {"events_by_message": result}


@router.get("/sessions")
async def list_sessions():
    """List all sessions that have sent events."""
    sessions = conversation_store.get_event_sessions()
    return {"sessions": sessions}


# Compaction timestamps live in the compact_timestamps table of the
# consolidated DB. The old .soren/.compact-timestamps file was rewritten
# wholesale both here (read + full write_text) and by compact.sh (grep-filter
# tmp+mv) with no coordination — a live race. The table upsert is atomic; the
# legacy file is imported once, lazily, then renamed *.migrated (either side
# may do the import — an atomic rename is the claim).
_COMPACT_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS compact_timestamps (
    window     TEXT PRIMARY KEY,
    epoch      INTEGER NOT NULL,
    updated_at TEXT
)
"""


def _legacy_compact_file() -> Path:
    return Path(settings.soren_dir) / ".compact-timestamps"


def _migrate_compact_timestamps(conn) -> None:
    """One-time lazy import of the legacy 'window=epoch' lines file."""
    legacy = _legacy_compact_file()
    if not legacy.exists():
        return
    claim = legacy.with_name(f"{legacy.name}.importing.{os.getpid()}")
    try:
        legacy.rename(claim)  # atomic claim — exactly one importer wins
    except OSError:
        return
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        for line in claim.read_text().splitlines():
            window, sep, epoch_str = line.partition("=")
            if not sep or not window:
                continue
            try:
                epoch = int(float(epoch_str))
            except ValueError:
                continue
            # Keep the newer epoch if the table already has one (compact.sh
            # may have written between our claim and this insert).
            conn.execute(
                """
                INSERT INTO compact_timestamps (window, epoch, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(window) DO UPDATE
                    SET epoch = excluded.epoch, updated_at = excluded.updated_at
                    WHERE excluded.epoch > compact_timestamps.epoch
                """,
                (window, epoch, now),
            )
    except Exception as exc:
        logger.warning(f"Failed to import legacy compact timestamps: {exc}")
    finally:
        try:
            claim.rename(legacy.with_name(f"{legacy.name}.migrated"))
        except OSError:
            pass


def _get_last_compact_time(window: str) -> float:
    """Return epoch of last compaction for window, or 0.0 if never."""
    try:
        with get_db() as conn:
            conn.execute(_COMPACT_TABLE_SQL)
            _migrate_compact_timestamps(conn)
            row = conn.execute(
                "SELECT epoch FROM compact_timestamps WHERE window = ?",
                (window,),
            ).fetchone()
            return float(row["epoch"]) if row else 0.0
    except Exception as exc:
        logger.warning(f"Failed to read compact timestamps: {exc}")
        return 0.0


def _set_last_compact_time(window: str, ts: float):
    """Record compaction timestamp for window."""
    try:
        with get_db() as conn:
            conn.execute(_COMPACT_TABLE_SQL)
            _migrate_compact_timestamps(conn)
            conn.execute(
                """
                INSERT INTO compact_timestamps (window, epoch, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(window) DO UPDATE
                    SET epoch = excluded.epoch, updated_at = excluded.updated_at
                """,
                (
                    window,
                    int(ts),
                    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                ),
            )
    except Exception as exc:
        logger.warning(f"Failed to update compact timestamps: {exc}")


async def _inject_recovery_message(session: str, window: str):
    """Inject recovery context message after compaction completes."""
    await asyncio.sleep(_RECOVERY_DELAY)
    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        recovery_msg = (
            f"You were just compacted. Read your recovery context from "
            f".soren/journal/{today}/artifacts/compaction-{window}-*.json "
            f"(most recent one). Also check your conversation history via "
            f"GET /api/agents/{window}/history if anything is unclear."
        )
        await tmux_service.send_input(window, recovery_msg, session)
        logger.info(f"Injected recovery message for {window}")
    except Exception as exc:
        logger.warning(f"Failed to inject recovery message for {window}: {exc}")


async def _maybe_compact_agent(event: AgentEvent, display_agent_id: str):
    """Trigger /compact if this Stop event shows context usage above threshold."""
    if event.event_type != AgentEventType.STOP:
        return
    usage = event.usage
    if not usage or not isinstance(usage, dict):
        return

    # Context size = fresh input + cached prefix + output of the final turn.
    # (The soren-bridge plugin reports the last assistant message's tokens;
    # with prompt caching most of the context sits in cache_read.)
    input_tokens = int(usage.get("input_tokens", 0) or 0)
    cache_read_tokens = int(usage.get("cache_read_input_tokens", 0) or 0)
    output_tokens = int(usage.get("output_tokens", 0) or 0)
    total_tokens = input_tokens + cache_read_tokens + output_tokens
    if total_tokens == 0:
        return

    usage_ratio = total_tokens / _CONTEXT_WINDOW
    if usage_ratio < _COMPACT_THRESHOLD:
        return

    # Resolve identifier → (session, window)
    try:
        session, window = agent_manager.parse_agent_id(display_agent_id)
    except Exception:
        return

    # Never compact supervisor
    if window == "supervisor" or window.startswith("supervisor-"):
        return

    # Skip SLEEPING agents (tmux window doesn't exist)
    meta = (
        agent_registry.get_agent_metadata(display_agent_id)
        or agent_registry.get_agent_metadata(window)
    )
    if meta and meta.get("status") == "SLEEPING":
        return

    # Enforce cooldown
    now = time.time()
    last_compact = _get_last_compact_time(window)
    if last_compact > 0 and (now - last_compact) < _COMPACT_COOLDOWN:
        elapsed = int(now - last_compact)
        logger.debug(
            f"Compaction skipped for {window}: cooldown "
            f"({elapsed}s / {_COMPACT_COOLDOWN}s since last)"
        )
        return

    logger.info(
        f"Triggering /compact for {window} "
        f"({usage_ratio:.1%} of {_CONTEXT_WINDOW} token window)"
    )
    try:
        await tmux_service.send_input(window, "/compact", session)
        _set_last_compact_time(window, now)
        _pending_compactions[display_agent_id] = input_tokens
        asyncio.create_task(_inject_recovery_message(session, window))
    except Exception as exc:
        logger.warning(f"Failed to send /compact to {window}: {exc}")


def _record_compaction_effectiveness(agent_id: str, pre_tokens: int, post_tokens: int):
    """Append a compaction record to the JSONL effectiveness file."""
    try:
        record = json.dumps({
            "agent": agent_id,
            "pre_tokens": pre_tokens,
            "post_tokens": post_tokens,
            "reduction_pct": round((1 - post_tokens / pre_tokens) * 100, 1) if pre_tokens > 0 else 0,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        })
        _COMPACT_EFFECTIVENESS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(_COMPACT_EFFECTIVENESS_FILE, "a") as f:
            f.write(record + "\n")
        logger.info(f"Compaction effectiveness: {agent_id} {pre_tokens}→{post_tokens} tokens")
    except Exception as exc:
        logger.warning(f"Failed to record compaction effectiveness: {exc}")


def _truncate_content(content: Any, max_length: int = 1000) -> Any:
    """Truncate content for storage/display."""
    if content is None:
        return None
    if isinstance(content, str):
        if len(content) > max_length:
            return content[:max_length] + "... [truncated]"
        return content
    if isinstance(content, dict):
        # Recursively truncate dict values
        return {k: _truncate_content(v, max_length) for k, v in content.items()}
    if isinstance(content, list):
        return [_truncate_content(item, max_length) for item in content[:10]]
    return content
