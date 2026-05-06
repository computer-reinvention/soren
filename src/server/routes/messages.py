from fastapi import APIRouter, HTTPException, Query
from datetime import datetime, timezone
from typing import Optional
import uuid
import logging

from pydantic import BaseModel

from ..models.message import Message, MessageList, UserMessage, InternalMessage, InboxResponse, MessageType, TaskStatus, StatusUpdateRequest
from ..services.mailbox import mailbox_service
from ..services.conversation_store import conversation_store
from ..services.failure_log import log_failure

from ..websocket.manager import ws_manager


class VerifyResultRequest(BaseModel):
    """Request body for POST /api/messages/verify-result."""
    agent_id: str
    result: str  # "verified" or "verify-failed"
    commit_sha: Optional[str] = None
    original_message_id: Optional[str] = None
    details: Optional[str] = None

logger = logging.getLogger(__name__)

router = APIRouter()

# Internal verification tags that should never surface to the user dashboard.
# Matched against the start of message content.
_INTERNAL_TAGS = (
    "[COMMIT-CHECK]", "[VERIFY-WARN]", "[VERIFY-FAILED]",
    "[FIX-REQUEST]", "[UI-CHECK]",
)


@router.get("", response_model=MessageList)
async def get_messages(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    agent_id: Optional[str] = None
):
    """Get message history with optional filtering and pagination."""
    total = conversation_store.count_messages(agent_id=agent_id)
    messages = conversation_store.get_messages(
        limit=limit,
        offset=offset,
        agent_id=agent_id
    )
    has_more = (offset + len(messages)) < total
    return MessageList(messages=messages, total=total, has_more=has_more)


@router.get("/tasks", response_model=MessageList)
async def get_tasks(
    status: Optional[TaskStatus] = Query(default=None, description="Filter by task status"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Get all messages with task lifecycle status, optionally filtered by status."""
    messages = conversation_store.get_tasks(status=status, limit=limit, offset=offset)
    return MessageList(messages=messages, total=len(messages))


@router.get("/inbox/{agent_id}", response_model=InboxResponse)
async def get_inbox(
    agent_id: str,
    limit: int = Query(default=200, le=500),
    offset: int = Query(default=0, ge=0),
):
    """Get inbox for an agent: pinned task assignment and all messages.

    Returns the first [TASK] message sent to this agent as the pinned task,
    plus all messages where the agent is sender or recipient, ordered
    timestamp ASC (oldest first).
    """
    pinned_task, messages, total = conversation_store.get_inbox(
        agent_id=agent_id,
        limit=limit,
        offset=offset,
    )
    return InboxResponse(pinned_task=pinned_task, messages=messages, total=total)


@router.patch("/{message_id}/status")
async def update_message_status(message_id: str, body: StatusUpdateRequest):
    """Update a message's task lifecycle status."""
    updated = mailbox_service.update_message_status(message_id, body.status)
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")
    # Broadcast status change to frontend
    await ws_manager.broadcast("task_status_update", {
        "message_id": message_id,
        "status": body.status.value,
    })
    return {"status": "updated", "message_id": message_id, "task_status": body.status.value}


@router.post("/user")
async def send_to_user(message: UserMessage):
    """Endpoint for agents to send messages to user (displayed in dashboard).

    HOW SUPERVISOR/AGENT REPLIES REACH THE FRONTEND:
    - Agent text output to terminal stays in tmux only (not automatic)
    - To display a message in the dashboard, agents must explicitly use:
        ./tools/mailbox send user "subject" "body"
      or:
        ./tools/mailbox quick user "message"
    - This calls the API directly for user-targeted messages
    - The router.sh daemon also routes "-> user" messages through this endpoint

    This is by design: explicit mailbox communication keeps the dashboard
    focused on intentional agent-to-user messages, not terminal noise.
    """
    msg = Message(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        from_agent=message.from_agent,
        to_agent="user",
        type=MessageType.USER,
        content=message.content
    )

    await ws_manager.broadcast("user_message", msg.model_dump(mode="json"))

    return {"success": True, "message_id": msg.id}


@router.post("/internal")
async def store_internal_message(data: InternalMessage):
    """Store agent-to-agent message from router daemon.

    Called by router.sh when routing messages between agents.
    Stores message in SQLite and broadcasts to frontend via WebSocket.

    Internal verification messages (COMMIT-CHECK, FIX-REQUEST, etc.) are
    silently dropped — they're agent-to-agent and should never surface
    to the user dashboard. This is defense-in-depth alongside router.sh
    filtering.
    """
    # Drop internal verification messages
    content_stripped = (data.content or "").strip()
    if any(content_stripped.startswith(tag) for tag in _INTERNAL_TAGS):
        logger.debug(
            f"Dropping internal message from {data.from_agent}: "
            f"{content_stripped[:60]}"
        )
        return {"status": "dropped", "id": None, "reason": "internal_verification"}

    msg = Message(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        from_agent=data.from_agent,
        to_agent=data.to_agent,
        content=data.content,
        type=data.type,
        metadata=data.metadata,
        task_status=data.task_status,
    )

    # Store in memory + SQLite
    mailbox_service.store_message(msg)

    # Broadcast to frontend
    await ws_manager.broadcast("new_message", msg.model_dump(mode="json"))

    return {"status": "stored", "id": msg.id}


@router.post("/verify-result")
async def store_verify_result(body: VerifyResultRequest):
    """Store a task verification result (verified or verify-failed).

    On success, stores a status message with task_status=verified.
    On failure, stores with task_status=failed and logs to failure_log.
    """
    task_status = TaskStatus.VERIFIED if body.result == "verified" else TaskStatus.FAILED
    content = f"Verification: {body.result}"
    if body.commit_sha:
        content += f" (commit {body.commit_sha})"
    if body.details:
        content += f" — {body.details}"

    msg = Message(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        from_agent="system",
        to_agent=body.agent_id,
        type=MessageType.STATUS,
        content=content,
        task_status=task_status,
        parent_message_id=body.original_message_id,
    )

    mailbox_service.store_message(msg, parent_message_id=body.original_message_id)

    if body.result == "verify-failed":
        log_failure(
            agent_id=body.agent_id,
            failure_type="test_failure",
            description=body.details or f"Verification failed for commit {body.commit_sha or 'unknown'}",
            commit_sha=body.commit_sha,
        )

    await ws_manager.broadcast("task_status_update", {
        "message_id": msg.id,
        "status": task_status.value,
        "agent_id": body.agent_id,
    })

    return {"status": "stored", "id": msg.id, "task_status": task_status.value}
