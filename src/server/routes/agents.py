from fastapi import APIRouter, HTTPException, Request, WebSocket, WebSocketDisconnect, Body
from pydantic import BaseModel
from collections import defaultdict
from datetime import datetime, timezone
from typing import List
import asyncio
import json
import logging
import re
import uuid

from ..config import settings
from ..models.agent import Agent, AgentList, AgentMessage
from ..services.auth import decode_token
from ..models.message import Message, MessageType
from ..services.agent_manager import agent_manager
from ..services.tmux_service import tmux_service
from ..services.mailbox import mailbox_service
from ..services.agent_registry import agent_registry
from ..services.conversation_store import (
    conversation_store,
    ArchivedAgent,
    ArchivedAgentSummary,
)
from ..services import failure_log as failure_log_svc
from ..websocket.manager import ws_manager

logger = logging.getLogger(__name__)


def _username_from_request(request: Request) -> str:
    """Extract the authenticated username from cookie or Bearer header."""
    token = request.cookies.get("soren_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if token:
        username = decode_token(token)
        if username:
            return username
    return "user"


# Regex to extract @mentions from message content
MENTION_PATTERN = re.compile(r"@([\w-]+)")

# Timeout for WebSocket receive operations (seconds)
WS_RECEIVE_TIMEOUT = 60

router = APIRouter()


@router.get("", response_model=AgentList)
async def list_agents():
    """List all active agents."""
    agents = await agent_manager.list_agents()
    return AgentList(agents=agents, total=len(agents))


# IMPORTANT: /archived routes must come BEFORE /{agent_id} to avoid
# FastAPI matching "archived" as an agent_id
@router.get("/archived", response_model=List[ArchivedAgentSummary])
async def list_archived_agents():
    """List all archived agents."""
    return conversation_store.get_archived_agents()


@router.get("/archived/{archive_id}", response_model=ArchivedAgent)
async def get_archived_agent(archive_id: str):
    """Get a specific archived agent with terminal output."""
    archive = conversation_store.get_archive(archive_id)
    if not archive:
        raise HTTPException(status_code=404, detail="Archive not found")
    return archive


@router.get("/by-project/{project_id}")
async def list_agents_by_project(project_id: str):
    """List agents belonging to a specific project.

    Filters the agent registry by project_id and returns matching agents.
    """
    all_entries = agent_registry.get_all_entries()
    agents = []
    for key, entry in all_entries.items():
        if entry.get("project_id") == project_id:
            agents.append({"key": key, **entry})
    return {"project_id": project_id, "agents": agents, "total": len(agents)}


@router.get("/reliability")
async def get_agent_reliability():
    """Get per-agent verification counts from mailbox history.

    Counts [VERIFIED] and [VERIFY-FAILED] subjects per agent across the
    current mailbox and any mailbox archive files.
    """
    soren_dir = settings.soren_dir
    mailbox_files = []
    if (soren_dir / "mailbox").exists():
        mailbox_files.append(soren_dir / "mailbox")
    mailbox_files.extend(sorted(soren_dir.glob("mailbox.archive-*")))

    counts: dict[str, dict[str, int]] = defaultdict(lambda: {"verified": 0, "failed": 0})

    for path in mailbox_files:
        try:
            text = path.read_text()
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            subject = msg.get("subject", "")
            from_field = msg.get("from", "")
            # "soren:perm-backend" -> "perm-backend"; bare names pass through unchanged
            agent_id = from_field.split(":", 1)[-1] if ":" in from_field else from_field
            if not agent_id:
                continue
            if "[VERIFIED]" in subject:
                counts[agent_id]["verified"] += 1
            elif "[VERIFY-FAILED]" in subject:
                counts[agent_id]["failed"] += 1

    agents = []
    for agent_id, c in sorted(counts.items()):
        verified = c["verified"]
        failed = c["failed"]
        total = verified + failed
        success_rate = round(verified / total, 3) if total > 0 else 0.0
        agents.append({
            "agent_id": agent_id,
            "verified": verified,
            "failed": failed,
            "success_rate": success_rate,
        })

    return {"agents": agents}


@router.get("/failures")
async def get_failure_stats():
    """Return failure counts grouped by type and agent, plus 20 most recent failures."""
    return failure_log_svc.get_failure_stats()


class LogFailureRequest(BaseModel):
    agent_id: str
    failure_type: str
    description: str
    commit_sha: str | None = None
    root_cause: str | None = None  # JSON string from tools/root-cause


@router.post("/failures")
async def log_failure(body: LogFailureRequest):
    """Log a failure event (called by monitor.sh or agents on detected failures)."""
    valid_types = {"build_error", "test_failure", "import_error", "runtime_crash", "rollback", "timeout"}
    if body.failure_type not in valid_types:
        raise HTTPException(
            status_code=422,
            detail=f"failure_type must be one of: {', '.join(sorted(valid_types))}",
        )
    row_id = failure_log_svc.log_failure(
        agent_id=body.agent_id,
        failure_type=body.failure_type,  # type: ignore[arg-type]
        description=body.description,
        commit_sha=body.commit_sha,
        root_cause=body.root_cause,
    )
    return {"ok": True, "id": row_id}


@router.get("/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str):
    """Get details of a specific agent.

    Accepts both agent IDs (ag_xxxxxxxx) and window-based names.
    Agent ID lookup is tried first, then falls back to name.
    """
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.post("/{agent_id}/message")
async def send_message_to_agent(agent_id: str, message: AgentMessage, request: Request):
    """Send a message to a specific agent."""
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    username = _username_from_request(request)

    # Store the user message for chat history
    msg = Message(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        from_agent=username,
        to_agent=agent_id,
        type=MessageType.USER,
        content=message.content
    )
    mailbox_service.store_message(msg)

    # Prefix with [username] so the message starts with an alphabetic character.
    # This prevents tmux send-keys content (e.g. markdown like "- [ ] task")
    # from being interpreted as opencode autocomplete suggestions.
    prefixed_content = f"[{username}] {message.content}"
    await tmux_service.send_input(agent.tmux_window, prefixed_content)
    await ws_manager.broadcast("message_sent", {
        "agent_id": agent_id,
        "content": message.content[:100]
    })
    # Also broadcast the full message for chat UI
    await ws_manager.broadcast("new_message", msg.model_dump(mode="json"))

    # Route @mentions to mentioned agents (works from any agent context)
    mentioned_names = MENTION_PATTERN.findall(message.content)
    routed_to: list[str] = []
    for name in set(mentioned_names):
        if name == agent_id:
            continue  # Already receiving this message as primary target
        mentioned_agent = await agent_manager.get_agent(name)
        if mentioned_agent:
            # Send to the mentioned agent's tmux window
            mention_content = f"[soren:{username}] @you: {message.content}"
            await tmux_service.send_input(
                mentioned_agent.tmux_window, mention_content,
                session=mentioned_agent.session,
            )
            # Store mention-routed message so it appears in chat history
            mention_msg = Message(
                id=str(uuid.uuid4()),
                timestamp=datetime.now(timezone.utc),
                from_agent=username,
                to_agent=name,
                type=MessageType.USER,
                content=message.content,
                metadata={"mention_routed": True, "original_target": agent_id},
            )
            mailbox_service.store_message(mention_msg)
            await ws_manager.broadcast("new_message", mention_msg.model_dump(mode="json"))
            routed_to.append(name)
            logger.info(f"@mention routed message to {name}")

    return {"success": True, "agent_id": agent_id, "message_id": msg.id, "mention_routed_to": routed_to}


@router.post("/{agent_id}/interrupt")
async def interrupt_agent(agent_id: str):
    """Send interrupt signal (Ctrl+C) to an agent."""
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    await tmux_service.send_interrupt(agent.tmux_window)
    return {"success": True, "agent_id": agent_id}


@router.post("/{agent_id}/wake")
async def wake_agent(agent_id: str):
    """Wake a sleeping agent by re-creating its tmux window.

    The agent's registry metadata (display_name, agent_id, history) is preserved.
    Returns the woken agent or 404 if not found / not sleeping.
    """
    agent = await agent_manager.wake_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or not sleeping")
    await ws_manager.broadcast("agent_event", {"type": "agent_woke", "agent_id": agent_id})
    return agent


@router.post("/{agent_id}/keep-awake")
async def set_agent_keep_awake(agent_id: str, body: dict = Body(...)):
    """Set or clear the keep_awake flag for an agent.

    While keep_awake=true the auto-sleep task will never put this agent to sleep,
    regardless of how long it has been idle.

    Body: {"keep_awake": true|false}  (defaults to true if omitted)
    """
    value = bool(body.get("keep_awake", True))
    agent = await agent_manager.set_keep_awake(agent_id, value)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {"success": True, "agent_id": agent_id, "keep_awake": agent.keep_awake}


@router.post("/{agent_id}/compact")
async def compact_agent(agent_id: str):
    """Issue /compact command to an agent."""
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    await tmux_service.send_input(agent.tmux_window, "/compact")
    return {"success": True, "agent_id": agent_id}


@router.get("/{agent_id}/terminal")
async def get_agent_terminal(agent_id: str, lines: int = 50):
    """Get recent terminal output from agent's tmux pane."""
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    output = await tmux_service.capture_pane(agent.tmux_window, lines)
    return {"agent_id": agent_id, "output": output, "lines": lines}


@router.get("/{agent_id}/history")
async def get_agent_history(agent_id: str, limit: int = 50):
    """Get conversation history for an agent from the conversation store.

    Returns the last N messages involving this agent (both sent and received).
    Useful for agents recovering context after compaction.
    """
    messages = conversation_store.get_messages(limit=limit, agent_id=agent_id)
    return {
        "agent_id": agent_id,
        "messages": [msg.model_dump(mode="json") for msg in messages],
        "count": len(messages),
    }


@router.post("/{agent_id}/archive")
async def archive_agent(agent_id: str, lines: int = 2000):
    """Archive an agent's conversation and terminal output before killing.

    Captures terminal scrollback and stores it along with agent metadata
    in the archive database. Should be called before killing a worker.
    """
    agent = await agent_manager.get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Capture terminal output before archiving
    terminal_output = await tmux_service.capture_pane(agent.tmux_window, lines)

    # Archive the agent
    archive_id = conversation_store.archive_agent(
        agent_id=agent_id,
        agent_name=agent.name,
        agent_type=agent.type,
        terminal_output=terminal_output,
    )

    # Broadcast archive event for frontend to update
    await ws_manager.broadcast("agent_archived", {
        "archive_id": archive_id,
        "agent_id": agent_id,
        "agent_name": agent.name,
        "agent_type": agent.type,
        "archived_at": datetime.now(timezone.utc).isoformat(),
    })

    return {
        "success": True,
        "archive_id": archive_id,
        "agent_id": agent_id,
        "agent_name": agent.name,
    }


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    client_id = str(uuid.uuid4())
    await ws_manager.connect(websocket, client_id)
    try:
        while True:
            try:
                # Use timeout to prevent indefinitely blocking connections
                data = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=WS_RECEIVE_TIMEOUT
                )
                # Handle pong responses from clients
                if data:
                    try:
                        msg = json.loads(data)
                        if msg.get("event") == "pong":
                            logger.debug(f"Received pong from {client_id}")
                    except (json.JSONDecodeError, TypeError):
                        # Not JSON or not a pong, ignore
                        pass
            except asyncio.TimeoutError:
                # Timeout is expected - just continue the loop
                # The ping mechanism will detect dead connections
                continue
    except WebSocketDisconnect:
        logger.debug(f"WebSocket disconnect for {client_id}")
        await ws_manager.disconnect(client_id)
    except Exception as e:
        logger.warning(f"WebSocket error for {client_id}: {e}")
        await ws_manager.disconnect(client_id)


@router.post("/register")
async def register_agent(
    agent_id: str = Body(...),
    agent_type: str = Body("worker"),
    created_by: str = Body("system"),
    display_name: str = Body(None),
    role: str = Body(None),
    project_id: str = Body("soren"),
    unique_id: str = Body(None),
):
    """Internal endpoint for registering agents from shell scripts.

    Args:
        agent_id: Window-based identifier (name or session:name).
        agent_type: Legacy type field ("worker" or "supervisor").
        created_by: Who created this agent.
        display_name: Human-readable name (defaults to agent_id).
        role: Agent role ("worker", "supervisor", "project-supervisor").
        project_id: Project this agent belongs to.
        unique_id: Pre-assigned agent ID (ag_xxx). Generated if not provided.
    """
    metadata = {
        "type": agent_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": created_by,
        "project_id": project_id,
    }
    if display_name:
        metadata["display_name"] = display_name
    if role:
        metadata["role"] = role
    if unique_id:
        metadata["agent_id"] = unique_id

    entry = agent_registry.register(agent_id, metadata)
    return {"registered": agent_id, "agent_id": entry.get("agent_id")}


@router.delete("/register/{agent_id:path}")
async def unregister_agent(agent_id: str):
    """Internal endpoint for unregistering agents."""
    agent_registry.unregister(agent_id)
    return {"unregistered": agent_id}
