from fastapi import APIRouter, HTTPException

from ..models.session import Session, SessionCreate, SessionList, SessionMessage
from ..services.session_manager import session_manager
from ..websocket.manager import ws_manager
from ..config import settings

router = APIRouter()


@router.get("", response_model=SessionList)
async def list_sessions():
    """List all active SOREN sessions."""
    sessions = await session_manager.list_sessions()
    return SessionList(sessions=sessions, total=len(sessions))


@router.post("", response_model=Session)
async def create_session(data: SessionCreate):
    """Create a new SOREN session with a supervisor.

    The session will be named soren-{name} and have a supervisor agent
    named supervisor-{name}.
    """
    try:
        session = await session_manager.create_session(
            name=data.name,
            task_description=data.task_description,
            template=data.template
        )

        # Broadcast session creation event
        await ws_manager.broadcast(
            "session_created",
            {"session": session.model_dump(mode="json")}
        )

        return session
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{session_id}", response_model=Session)
async def get_session(session_id: str):
    """Get details for a specific session."""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}")
async def terminate_session(session_id: str):
    """Terminate a session gracefully.

    Sends /exit to all workers, waits, then kills the tmux session.
    The main soren session cannot be terminated.
    """
    # Protect main session
    if session_id == settings.main_session:
        raise HTTPException(
            status_code=403,
            detail="Cannot terminate the main session. It is immortal."
        )

    success = await session_manager.terminate_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found or termination failed")

    # Broadcast termination event
    await ws_manager.broadcast(
        "session_terminated",
        {"session_id": session_id, "reason": "User requested termination"}
    )

    return {"success": True, "message": f"Session {session_id} terminated"}


@router.post("/{session_id}/pause")
async def pause_session(session_id: str):
    """Pause a session by notifying the supervisor to stop processing."""
    success = await session_manager.pause_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    # Broadcast status change
    await ws_manager.broadcast(
        "session_status_changed",
        {"session_id": session_id, "status": "PAUSED"}
    )

    return {"success": True, "message": f"Session {session_id} paused"}


@router.post("/{session_id}/resume")
async def resume_session(session_id: str):
    """Resume a paused session."""
    success = await session_manager.resume_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")

    # Broadcast status change
    await ws_manager.broadcast(
        "session_status_changed",
        {"session_id": session_id, "status": "ACTIVE"}
    )

    return {"success": True, "message": f"Session {session_id} resumed"}


@router.post("/{session_id}/clear")
async def clear_session(session_id: str):
    """Send /clear to the session's supervisor for a fresh conversation."""
    success = await session_manager.clear_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "message": f"Session {session_id} supervisor cleared"}


@router.post("/{session_id}/message")
async def send_message_to_session(session_id: str, data: SessionMessage):
    """Send a message to the session's supervisor."""
    success = await session_manager.send_message_to_session(session_id, data.content)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"success": True, "message": "Message sent to supervisor"}


@router.get("/{session_id}/agents")
async def list_session_agents(session_id: str):
    """List all agents in a session."""
    session = await session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    agents = await session_manager.list_session_agents(session_id)
    return {"session_id": session_id, "agents": agents, "total": len(agents)}
