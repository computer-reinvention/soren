import asyncio
import os
from typing import List, Optional

from ..config import settings
from ..models.session import Session, SessionStatus
from .tmux_service import tmux_service


class SessionManager:
    """Manages SOREN sessions (main + spawned sessions).

    Session lifecycle:
    - Main session (soren) is immortal and cannot be killed
    - Spawned sessions (soren-*) can be created, paused, and terminated
    - Each session has a supervisor and zero or more workers
    """

    def __init__(self):
        self._sessions: dict[str, Session] = {}

    async def list_sessions(self) -> List[Session]:
        """List all active SOREN sessions."""
        tmux_sessions = await tmux_service.list_sessions()
        sessions = []

        for sess_name in tmux_sessions:
            # Get or create session object
            if sess_name in self._sessions:
                session = self._sessions[sess_name]
            else:
                session = await self._build_session_from_tmux(sess_name)
                if session:
                    self._sessions[sess_name] = session

            if session:
                # Update agent count
                windows = await tmux_service.list_windows(sess_name)
                session.agent_count = len([w for w in windows if w not in settings.system_windows])
                sessions.append(session)

        return sessions

    async def get_session(self, session_id: str) -> Optional[Session]:
        """Get a specific session by ID."""
        if session_id not in self._sessions:
            await self.list_sessions()
        return self._sessions.get(session_id)

    async def _build_session_from_tmux(self, session_name: str) -> Optional[Session]:
        """Build a Session object from an existing tmux session."""
        if not await tmux_service.session_exists(session_name):
            return None

        is_main = session_name == settings.main_session
        windows = await tmux_service.list_windows(session_name)

        # Find the supervisor window
        supervisor = None
        for w in windows:
            if w == "supervisor" or w.startswith("supervisor-"):
                supervisor = w
                break

        if not supervisor:
            return None  # Not a valid SOREN session without a supervisor

        # Generate human-readable name
        if is_main:
            name = "Main"
        else:
            # Remove soren- prefix for display name
            name = session_name.replace(settings.session_prefix, "").replace("-", " ").title()

        return Session(
            id=session_name,
            name=name,
            supervisor_agent=supervisor,
            is_main=is_main,
            agent_count=len([w for w in windows if w not in settings.system_windows])
        )

    async def create_session(
        self,
        name: str,
        task_description: str,
        template: Optional[str] = None
    ) -> Session:
        """Create a new SOREN session with a supervisor.

        Args:
            name: Session name (will be prefixed with soren-)
            task_description: Description of what this session is for
            template: Optional template name (without .md) from docs/templates/

        Returns:
            The created Session object

        Raises:
            ValueError: If session name is invalid or already exists
        """
        # Sanitize name
        safe_name = name.lower().replace(" ", "-").replace("_", "-")
        session_id = f"{settings.session_prefix}{safe_name}"
        supervisor_name = f"supervisor-{safe_name}"

        # Check if already exists
        if await tmux_service.session_exists(session_id):
            raise ValueError(f"Session {session_id} already exists")

        # Get project root
        project_root = os.getcwd()

        # 1. Create tmux session with supervisor as the initial window
        # (spawned sessions don't need a monitor window - only main session has health monitoring)
        await tmux_service.create_session(session_id, initial_window=supervisor_name)

        # 3. Start Claude in supervisor window
        startup_cmd = (
            f"export SOREN_AGENT=true SOREN_AGENT_NAME={supervisor_name} "
            f"SOREN_SESSION={session_id} CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false "
            f"&& cd {project_root} && "
            f"claude --dangerously-skip-permissions"
        )
        await tmux_service.send_input(supervisor_name, startup_cmd, session_id)

        # 4. Wait for Claude to initialize (CRITICAL: 8 second delay)
        await asyncio.sleep(settings.claude_startup_delay)

        # 5. Disable vim mode if enabled (for reliable message delivery)
        await tmux_service.disable_vim_mode(supervisor_name, session_id)
        await asyncio.sleep(1)

        # 6. Send role instructions
        template_path = f"docs/templates/{template}.md" if template else "docs/templates/FEATURE_SUPERVISOR.md"
        role_msg = f"Read {template_path} to understand your role. Your task: {task_description}"
        await tmux_service.send_input(supervisor_name, role_msg, session_id)

        # 6. Build and store session object
        session = Session(
            id=session_id,
            name=name.title(),
            supervisor_agent=supervisor_name,
            task_description=task_description,
            template=template,
            is_main=False,
            agent_count=1
        )
        self._sessions[session_id] = session

        return session

    async def terminate_session(self, session_id: str) -> bool:
        """Terminate a session gracefully.

        Sends /exit to all workers, waits, then kills the session.
        Main session cannot be terminated.

        Returns:
            True if terminated, False if failed or not allowed
        """
        # Protect main session
        if session_id == settings.main_session:
            return False

        session = await self.get_session(session_id)
        if not session:
            return False

        # Get all windows (agents)
        windows = await tmux_service.list_windows(session_id)
        workers = [w for w in windows if w not in settings.system_windows and not w.startswith("supervisor")]

        # Graceful shutdown: send /exit to workers
        for worker in workers:
            await tmux_service.send_input(worker, "/exit", session_id)

        # Wait for workers to exit
        await asyncio.sleep(3)

        # Kill the session
        success = await tmux_service.kill_session(session_id)

        if success and session_id in self._sessions:
            del self._sessions[session_id]

        return success

    async def pause_session(self, session_id: str) -> bool:
        """Pause a session by notifying the supervisor to stop processing."""
        session = await self.get_session(session_id)
        if not session:
            return False

        # Send pause message to supervisor
        await tmux_service.send_input(
            session.supervisor_agent,
            "[SYSTEM] Session paused. Stop processing new tasks until resumed.",
            session_id
        )

        session.status = SessionStatus.PAUSED
        return True

    async def resume_session(self, session_id: str) -> bool:
        """Resume a paused session."""
        session = await self.get_session(session_id)
        if not session:
            return False

        # Send resume message to supervisor
        await tmux_service.send_input(
            session.supervisor_agent,
            "[SYSTEM] Session resumed. You may continue processing tasks.",
            session_id
        )

        session.status = SessionStatus.ACTIVE
        return True

    async def clear_session(self, session_id: str) -> bool:
        """Send /clear to the supervisor for a fresh conversation."""
        session = await self.get_session(session_id)
        if not session:
            return False

        await tmux_service.send_input(
            session.supervisor_agent,
            "/clear",
            session_id
        )
        return True

    async def send_message_to_session(self, session_id: str, message: str) -> bool:
        """Send a message to the session's supervisor."""
        session = await self.get_session(session_id)
        if not session:
            return False

        # Format message so supervisor knows it's from dashboard
        # Send raw message (multiline formatted messages break tmux send-keys)
        await tmux_service.send_input(session.supervisor_agent, message, session_id)
        return True

    async def list_session_agents(self, session_id: str) -> List[str]:
        """List all agents (windows) in a session, excluding system windows."""
        windows = await tmux_service.list_windows(session_id)
        return [w for w in windows if w not in settings.system_windows]


session_manager = SessionManager()
