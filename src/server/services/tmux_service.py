import asyncio
import tempfile
import os
from typing import List, Optional

from ..config import settings

# Threshold for using load-buffer instead of send-keys (4KB)
LONG_MESSAGE_THRESHOLD = 4096


class TmuxDeliveryError(Exception):
    """A message could not actually be delivered to a tmux window.

    Raised when the target window doesn't exist (agent never spawned,
    asleep, or crashed) or when an underlying tmux command itself failed
    (nonzero exit). Previously send_input() never checked either of these
    — a message to a dead/sleeping agent silently "succeeded" from the
    caller's point of view (HTTP 200, stored in chat history) while never
    actually reaching anything. This exception lets callers distinguish
    "the tmux delivery genuinely failed" from "it worked" so they can
    surface that to the user instead of lying about success.
    """

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class TmuxService:
    def __init__(self):
        self.default_session = settings.tmux_session
        # Per-target-window locks. Without this, two concurrent sends to
        # the same window (double-click Send, multiple browser tabs, a
        # direct message racing an @mention-routed one) each independently
        # run send-keys(text) -> sleep -> send-keys(Enter) as unsynchronized
        # asyncio tasks, which can interleave at the tmux level and garble
        # both messages together. Serializing per-window (not globally)
        # keeps unrelated agents' sends fully concurrent.
        self._send_locks: dict[str, asyncio.Lock] = {}

    def _lock_for(self, target: str) -> asyncio.Lock:
        lock = self._send_locks.get(target)
        if lock is None:
            lock = asyncio.Lock()
            self._send_locks[target] = lock
        return lock

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

    async def send_input(self, window: str, text: str, session: Optional[str] = None) -> None:
        """Send text input to a tmux window.

        For short messages: Uses send-keys -l (literal) then Enter separately.
        For long messages (>4KB): Uses load-buffer/paste-buffer via temp file
        to bypass ARG_MAX command-line limits.

        Raises TmuxDeliveryError if the target window doesn't exist, or if
        any underlying tmux command actually fails. Concurrent sends to the
        same window are serialized (see _send_locks) so they can't interleave.
        """
        session = session or self.default_session
        target = f"{session}:{window}"

        async with self._lock_for(target):
            if not await self.window_exists(window, session):
                raise TmuxDeliveryError(
                    f"window '{target}' does not exist (agent not spawned, asleep, or crashed)"
                )

            if len(text) > LONG_MESSAGE_THRESHOLD:
                # Long message: use load-buffer/paste-buffer via temp file
                await self._send_via_buffer(target, text)
            else:
                # Short message: use send-keys -l
                _, stderr, rc = await self._run_command([
                    "tmux", "send-keys", "-t", target, "-l", text
                ])
                if rc != 0:
                    raise TmuxDeliveryError(f"tmux send-keys failed (rc={rc}): {stderr.strip()}")

            # Delay for multiline paste to be processed
            # The TUI shows a pasted-text placeholder and needs time to register
            if "\n" in text:
                await asyncio.sleep(0.15)  # 150ms delay for multiline
            else:
                await asyncio.sleep(0.05)  # 50ms for single line

            # Send Enter SEPARATELY to submit
            _, stderr, rc = await self._run_command([
                "tmux", "send-keys", "-t", target, "Enter"
            ])
            if rc != 0:
                raise TmuxDeliveryError(f"tmux send-keys Enter failed (rc={rc}): {stderr.strip()}")

    async def _send_via_buffer(self, target: str, text: str) -> None:
        """Send long text via tmux load-buffer/paste-buffer to bypass ARG_MAX."""
        # Create temp file with the message content
        fd, tmp_path = tempfile.mkstemp(prefix="soren_msg_", suffix=".txt")
        try:
            os.write(fd, text.encode("utf-8"))
            os.close(fd)

            # Load into tmux buffer
            _, stderr, rc = await self._run_command([
                "tmux", "load-buffer", tmp_path
            ])
            if rc != 0:
                raise TmuxDeliveryError(f"tmux load-buffer failed (rc={rc}): {stderr.strip()}")

            # Paste buffer into target pane
            _, stderr, rc = await self._run_command([
                "tmux", "paste-buffer", "-t", target
            ])
            if rc != 0:
                raise TmuxDeliveryError(f"tmux paste-buffer failed (rc={rc}): {stderr.strip()}")
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    async def send_interrupt(self, window: str, session: Optional[str] = None) -> None:
        """Send Ctrl+C to a tmux window.

        Raises TmuxDeliveryError if the window doesn't exist or the
        underlying tmux command fails — previously this silently no-op'd
        on a dead/missing window, so the "interrupt" API endpoint returned
        {"success": true} even when nothing was actually interrupted.
        """
        session = session or self.default_session
        target = f"{session}:{window}"
        async with self._lock_for(target):
            if not await self.window_exists(window, session):
                raise TmuxDeliveryError(
                    f"window '{target}' does not exist (agent not spawned, asleep, or crashed)"
                )
            _, stderr, rc = await self._run_command([
                "tmux", "send-keys", "-t", target, "C-c"
            ])
            if rc != 0:
                raise TmuxDeliveryError(f"tmux send-keys C-c failed (rc={rc}): {stderr.strip()}")

    async def capture_pane(self, window: str, lines: int = 100, session: Optional[str] = None) -> str:
        """Capture recent output from a tmux pane."""
        session = session or self.default_session
        stdout, _, _ = await self._run_command([
            "tmux", "capture-pane", "-t", f"{session}:{window}",
            "-p", "-S", f"-{lines}"
        ])
        return stdout

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
