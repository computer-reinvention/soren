import asyncio
import tempfile
import os
from typing import List, Optional

from ..config import settings

# Threshold for using load-buffer instead of send-keys (4KB)
LONG_MESSAGE_THRESHOLD = 4096


class TmuxService:
    def __init__(self):
        self.default_session = settings.tmux_session

    async def _run_command(self, cmd: List[str]) -> tuple[str, str, int]:
        """Run tmux command and return stdout, stderr, return code."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await proc.communicate()
        return stdout.decode(), stderr.decode(), proc.returncode or 0

    async def list_sessions(self) -> List[str]:
        """List all soren sessions (main + spawned)."""
        stdout, _, _ = await self._run_command([
            "tmux", "list-sessions", "-F", "#{session_name}"
        ])
        sessions = [s.strip() for s in stdout.strip().split("\n") if s.strip()]
        # Filter to only soren sessions
        return [s for s in sessions if s == settings.main_session or s.startswith(settings.session_prefix)]

    async def session_exists(self, session: str) -> bool:
        """Check if a tmux session exists."""
        _, _, rc = await self._run_command([
            "tmux", "has-session", "-t", session
        ])
        return rc == 0

    async def create_session(self, session: str, initial_window: str = "main") -> bool:
        """Create a new tmux session.

        Args:
            session: Session name
            initial_window: Name for the initial window (default: "main")
        """
        _, stderr, _ = await self._run_command([
            "tmux", "new-session", "-d", "-s", session, "-n", initial_window
        ])
        return not stderr

    async def kill_session(self, session: str) -> bool:
        """Kill a tmux session."""
        _, stderr, _ = await self._run_command([
            "tmux", "kill-session", "-t", session
        ])
        return not stderr

    async def list_windows(self, session: Optional[str] = None) -> List[str]:
        """List all windows in a session."""
        session = session or self.default_session
        stdout, _, _ = await self._run_command([
            "tmux", "list-windows", "-t", session, "-F", "#{window_name}"
        ])
        return [w.strip() for w in stdout.strip().split("\n") if w.strip()]

    async def window_exists(self, window: str, session: Optional[str] = None) -> bool:
        """Check if a window exists in a session."""
        session = session or self.default_session
        windows = await self.list_windows(session)
        return window in windows

    async def send_input(self, window: str, text: str, session: Optional[str] = None):
        """Send text input to a tmux window.

        For short messages: Uses send-keys -l (literal) then Enter separately.
        For long messages (>4KB): Uses load-buffer/paste-buffer via temp file
        to bypass ARG_MAX command-line limits.
        """
        session = session or self.default_session
        target = f"{session}:{window}"

        if len(text) > LONG_MESSAGE_THRESHOLD:
            # Long message: use load-buffer/paste-buffer via temp file
            await self._send_via_buffer(target, text)
        else:
            # Short message: use send-keys -l
            await self._run_command([
                "tmux", "send-keys", "-t", target, "-l", text
            ])

        # Delay for multiline paste to be processed
        # Claude Code shows "[Pasted text #N +X lines]" and needs time to register
        if "\n" in text:
            await asyncio.sleep(0.15)  # 150ms delay for multiline
        else:
            await asyncio.sleep(0.05)  # 50ms for single line

        # Send Enter SEPARATELY to submit
        await self._run_command([
            "tmux", "send-keys", "-t", target, "Enter"
        ])

    async def _send_via_buffer(self, target: str, text: str):
        """Send long text via tmux load-buffer/paste-buffer to bypass ARG_MAX."""
        # Create temp file with the message content
        fd, tmp_path = tempfile.mkstemp(prefix="soren_msg_", suffix=".txt")
        try:
            os.write(fd, text.encode("utf-8"))
            os.close(fd)

            # Load into tmux buffer
            await self._run_command([
                "tmux", "load-buffer", tmp_path
            ])

            # Paste buffer into target pane
            await self._run_command([
                "tmux", "paste-buffer", "-t", target
            ])
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def send_interrupt(self, window: str, session: Optional[str] = None):
        """Send Ctrl+C to a tmux window."""
        session = session or self.default_session
        await self._run_command([
            "tmux", "send-keys", "-t", f"{session}:{window}", "C-c"
        ])

    async def capture_pane(self, window: str, lines: int = 100, session: Optional[str] = None) -> str:
        """Capture recent output from a tmux pane."""
        session = session or self.default_session
        stdout, _, _ = await self._run_command([
            "tmux", "capture-pane", "-t", f"{session}:{window}",
            "-p", "-S", f"-{lines}"
        ])
        return stdout

    async def is_vim_mode_enabled(self, window: str, session: Optional[str] = None) -> bool:
        """Check if Claude Code's vim mode is enabled by looking for mode indicators."""
        import re
        output = await self.capture_pane(window, lines=5, session=session)
        return bool(re.search(r"-- (INSERT|NORMAL|VISUAL) --", output))

    async def disable_vim_mode(self, window: str, session: Optional[str] = None) -> bool:
        """Disable vim mode if it's enabled. Returns True if vim mode was disabled."""
        if await self.is_vim_mode_enabled(window, session):
            await self.send_input(window, "/vim", session)
            return True
        return False

    async def create_window(self, name: str, session: Optional[str] = None) -> bool:
        """Create a new tmux window."""
        session = session or self.default_session
        _, stderr, _ = await self._run_command([
            "tmux", "new-window", "-t", f"{session}:", "-n", name
        ])
        return not stderr

    async def kill_window(self, name: str, session: Optional[str] = None) -> bool:
        """Kill a tmux window."""
        session = session or self.default_session
        _, stderr, _ = await self._run_command([
            "tmux", "kill-window", "-t", f"{session}:{name}"
        ])
        return not stderr


tmux_service = TmuxService()
