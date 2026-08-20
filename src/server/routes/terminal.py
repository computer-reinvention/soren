"""Interactive PTY terminal over WebSocket.

Endpoint: ``WS /api/terminal/ws?token=<jwt>&mode=shell|soren``

Frame protocol (JSON text frames):
- server -> client: ``{"type":"ready","mode":...}``, ``{"type":"output","data":str}``,
  ``{"type":"pong"}``, ``{"type":"error","message":str}``
- client -> server: ``{"type":"input","data":str}``, ``{"type":"resize","cols":int,"rows":int}``,
  ``{"type":"ping"}``

Modes:
- ``shell`` (default): attaches to (or creates) the ``webterm`` tmux session.
- ``soren``: creates a grouped viewport session (``view-<id>``) onto the main
  ``soren`` session so each client gets an independent current window; the
  viewport is killed on disconnect, the underlying session is untouched.

Auth happens in-handler (services/ws_auth.py) because the HTTP auth middleware
in main.py never runs for the websocket scope.
"""
import asyncio
import codecs
import contextlib
import fcntl
import json
import logging
import os
import pty
import shlex
import signal
import struct
import subprocess
import termios
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..config import settings
from ..services.ws_auth import authenticate_ws

logger = logging.getLogger(__name__)

router = APIRouter()

# Close codes (4000-4999 private-use range)
WS_CLOSE_BAD_MODE = 4400
WS_CLOSE_OVER_CAPACITY = 4429

# Defaults (env-overridable per connection)
DEFAULT_IDLE_TIMEOUT_SECONDS = 30 * 60  # SOREN_TERMINAL_IDLE_TIMEOUT
DEFAULT_MAX_TERMINALS = 4  # SOREN_TERMINAL_MAX

READ_CHUNK_SIZE = 65536
WEBTERM_SESSION = "webterm"

# Concurrent-terminal counter. Only mutated from the (single) event loop
# thread, so no lock is needed.
_active_terminals = 0


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ[name])
    except (KeyError, ValueError):
        return default


def _repo_root() -> Path:
    """Repo root for spawned shells: config-derived, not hardcoded.

    Prefers SOREN_PROJECT_ROOT (exported by the orchestrator); otherwise the
    parent of the resolved ``settings.soren_dir`` (default ``.soren`` relative
    to the server cwd, which the orchestrator sets to the repo root).
    """
    env_root = os.environ.get("SOREN_PROJECT_ROOT")
    if env_root:
        return Path(env_root)
    return settings.soren_dir.resolve().parent


def _preexec() -> None:
    """Run in the child between fork and exec.

    ``os.setsid()`` makes the child a session leader in its own process group
    (so we can SIGHUP/SIGKILL the whole group on teardown). TIOCSCTTY then
    adopts the pty slave (already dup'd onto fds 0/1/2) as the controlling
    terminal — without it the tty has no foreground process group and
    TIOCSWINSZ on the master never delivers SIGWINCH, so tmux ignores resizes
    (verified empirically on macOS).
    """
    os.setsid()
    try:
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)
    except OSError:
        pass  # best-effort; plain pipes-style children still work


async def _tmux_session_exists(name: str) -> bool:
    """Check for an exactly-named tmux session (``=`` prevents prefix matches,
    e.g. ``soren`` accidentally matching a ``soren-worker`` session)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "tmux", "has-session", "-t", f"={name}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        return (await proc.wait()) == 0
    except OSError:
        return False


def _tmux_kill_session_sync(name: str) -> None:
    """Best-effort kill of an exactly-named tmux session.

    Deliberately synchronous: it runs in the handler's ``finally`` block,
    which must survive task cancellation (the test client — and uvicorn on
    shutdown — cancels WS handlers on disconnect, and any ``await`` there
    re-raises CancelledError). tmux kill-session returns in milliseconds.
    """
    with contextlib.suppress(OSError, subprocess.TimeoutExpired):
        subprocess.run(
            ["tmux", "kill-session", "-t", f"={name}"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )


async def _set_aggressive_resize(session: str) -> None:
    """Best-effort: enable aggressive-resize on a session once it exists.

    ``new-session -A`` may still be creating the session when we return from
    spawn, so poll briefly. aggressive-resize sizes windows to the smallest
    session actually displaying them instead of the smallest attached client.
    """
    with contextlib.suppress(Exception):
        for _ in range(10):
            if await _tmux_session_exists(session):
                proc = await asyncio.create_subprocess_exec(
                    "tmux", "set-option", "-t", f"={session}",
                    "aggressive-resize", "on",
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.wait()
                return
            await asyncio.sleep(0.3)


class _PtyBridge:
    """Owns the PTY master fd, the child process, and the fd<->queue plumbing.

    Output flows: master fd --add_reader--> asyncio.Queue --pump task--> WS.
    Input flows: WS frame -> write() (buffered via add_writer if the master
    would block, so a stuck child can never block the event loop).
    """

    def __init__(self, cmd: list[str], cwd: Path):
        self.queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._loop = asyncio.get_running_loop()
        self._write_buf = b""
        self._reader_attached = False
        self._writer_attached = False
        self._closed = False

        master_fd, slave_fd = pty.openpty()
        try:
            env = dict(os.environ, TERM="xterm-256color")
            self.proc = subprocess.Popen(
                cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                preexec_fn=_preexec,
                cwd=str(cwd),
                env=env,
                close_fds=True,
            )
        except BaseException:
            os.close(master_fd)
            raise
        finally:
            # Exactly one close of the slave: on success the child holds its
            # own dup'd copies on fds 0/1/2, on failure it's simply released.
            with contextlib.suppress(OSError):
                os.close(slave_fd)

        self.master_fd = master_fd
        os.set_blocking(self.master_fd, False)
        self._loop.add_reader(self.master_fd, self._on_readable)
        self._reader_attached = True

    # --- output path (child -> ws) ---

    def _on_readable(self) -> None:
        try:
            chunk = os.read(self.master_fd, READ_CHUNK_SIZE)
        except BlockingIOError:
            return
        except OSError:
            # EIO: child exited and slave side closed (Linux); treat as EOF
            chunk = b""
        if chunk:
            self.queue.put_nowait(chunk)
        else:
            self._detach_reader()
            self.queue.put_nowait(None)  # EOF sentinel

    def _detach_reader(self) -> None:
        if self._reader_attached:
            with contextlib.suppress(Exception):
                self._loop.remove_reader(self.master_fd)
            self._reader_attached = False

    # --- input path (ws -> child) ---

    def write(self, data: bytes) -> None:
        if self._closed or not data:
            return
        self._write_buf += data
        self._flush()

    def _flush(self) -> None:
        while self._write_buf:
            try:
                n = os.write(self.master_fd, self._write_buf)
            except BlockingIOError:
                break
            except OSError:
                self._write_buf = b""
                self._detach_writer()
                return
            self._write_buf = self._write_buf[n:]
        if self._write_buf and not self._writer_attached:
            self._loop.add_writer(self.master_fd, self._flush_and_maybe_detach)
            self._writer_attached = True
        elif not self._write_buf:
            self._detach_writer()

    def _flush_and_maybe_detach(self) -> None:
        self._flush()

    def _detach_writer(self) -> None:
        if self._writer_attached:
            with contextlib.suppress(Exception):
                self._loop.remove_writer(self.master_fd)
            self._writer_attached = False

    def resize(self, rows: int, cols: int) -> None:
        rows = max(1, min(int(rows), 9999))
        cols = max(1, min(int(cols), 9999))
        with contextlib.suppress(OSError, ValueError):
            fcntl.ioctl(
                self.master_fd,
                termios.TIOCSWINSZ,
                struct.pack("HHHH", rows, cols, 0, 0),
            )

    # --- teardown ---

    def close_now(self) -> None:
        """Idempotent teardown: detach fd callbacks, close the master, SIGHUP
        the child's process group, reap with a waitpid(WNOHANG) poll loop,
        escalate to SIGKILL if it lingers.

        Deliberately synchronous so it completes even when the handler task
        is being cancelled (any ``await`` in that state re-raises
        CancelledError and would abort mid-teardown, leaking the child).
        SIGHUP kills tmux/shell children within a few ms, so the bounded
        sleeps below are almost never reached in full.
        """
        if self._closed:
            return
        self._closed = True

        self._detach_reader()
        self._detach_writer()
        with contextlib.suppress(OSError):
            os.close(self.master_fd)

        # setsid in _preexec made proc.pid the process-group id
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(self.proc.pid, signal.SIGHUP)

        # Popen.poll() wraps waitpid(pid, WNOHANG)
        if self._reap(timeout=0.5):
            return
        with contextlib.suppress(ProcessLookupError, PermissionError, OSError):
            os.killpg(self.proc.pid, signal.SIGKILL)
        if not self._reap(timeout=1.0):
            logger.warning("Terminal child pid %s did not reap", self.proc.pid)

    def _reap(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.proc.poll() is not None:
                return True
            time.sleep(0.02)
        return self.proc.poll() is not None


async def _send_error(websocket: WebSocket, message: str) -> None:
    with contextlib.suppress(Exception):
        await websocket.send_json({"type": "error", "message": message})


async def _pump_output(bridge: _PtyBridge, websocket: WebSocket) -> None:
    """Forward PTY output to the client. Returns on child EOF or send failure."""
    # Incremental decoder so multi-byte UTF-8 split across read() chunks
    # doesn't produce replacement characters mid-stream.
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    while True:
        chunk = await bridge.queue.get()
        if chunk is None:
            return  # child exited / pty EOF
        text = decoder.decode(chunk)
        if not text:
            continue
        try:
            await websocket.send_json({"type": "output", "data": text})
        except Exception:
            return  # client gone; handler cleans up


async def _client_loop(
    bridge: _PtyBridge, websocket: WebSocket, idle_timeout: float
) -> None:
    """Process client frames until disconnect or idle timeout.

    Only ``input`` frames reset the idle clock; pings/resizes keep the socket
    alive but do not count as activity.
    """
    loop = asyncio.get_running_loop()
    last_input = loop.time()

    while True:
        remaining = idle_timeout - (loop.time() - last_input)
        if remaining <= 0:
            await _send_idle_timeout(websocket)
            return
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=remaining)
        except asyncio.TimeoutError:
            continue  # re-check the idle budget at loop top
        except WebSocketDisconnect:
            return

        try:
            frame = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frame, dict):
            continue

        frame_type = frame.get("type")
        if frame_type == "input":
            data = frame.get("data")
            if isinstance(data, str) and data:
                last_input = loop.time()
                bridge.write(data.encode("utf-8"))
        elif frame_type == "resize":
            try:
                bridge.resize(int(frame.get("rows")), int(frame.get("cols")))
            except (TypeError, ValueError):
                pass  # malformed resize frames are ignored
        elif frame_type == "ping":
            await websocket.send_json({"type": "pong"})


async def _send_idle_timeout(websocket: WebSocket) -> None:
    with contextlib.suppress(Exception):
        await websocket.send_json(
            {"type": "output", "data": "\r\n[soren] terminal idle timeout\r\n"}
        )


@router.websocket("/ws")
async def terminal_ws(websocket: WebSocket):
    """Interactive PTY over WebSocket (see module docstring for protocol)."""
    global _active_terminals

    username = await authenticate_ws(websocket)  # closes 4401 pre-accept on failure
    if username is None:
        return

    mode = websocket.query_params.get("mode", "shell")
    if mode not in ("shell", "soren"):
        await websocket.accept()
        await _send_error(websocket, f"unknown mode: {mode!r} (expected shell|soren)")
        with contextlib.suppress(Exception):
            await websocket.close(code=WS_CLOSE_BAD_MODE)
        return

    await websocket.accept()

    max_terminals = _env_int("SOREN_TERMINAL_MAX", DEFAULT_MAX_TERMINALS)
    if _active_terminals >= max_terminals:
        await _send_error(
            websocket, f"too many concurrent terminals (max {max_terminals})"
        )
        with contextlib.suppress(Exception):
            await websocket.close(code=WS_CLOSE_OVER_CAPACITY)
        return

    # Build the child command
    view_session: str | None = None
    override = os.environ.get("SOREN_TERMINAL_CMD")
    if override:
        # Test hook: replaces the command entirely (e.g. "/bin/cat")
        cmd = shlex.split(override)
    elif mode == "soren":
        if not await _tmux_session_exists(settings.tmux_session):
            await _send_error(
                websocket, f"tmux session '{settings.tmux_session}' is not running"
            )
            with contextlib.suppress(Exception):
                await websocket.close()
            return
        # Grouped viewport: shares soren's windows but has an independent
        # current window per client. Killed on disconnect (soren untouched).
        view_session = f"view-{uuid.uuid4().hex[:8]}"
        cmd = ["tmux", "new-session", "-t", f"={settings.tmux_session}", "-s", view_session]
    else:
        cmd = ["tmux", "new-session", "-A", "-s", WEBTERM_SESSION]

    idle_timeout = float(
        _env_int("SOREN_TERMINAL_IDLE_TIMEOUT", DEFAULT_IDLE_TIMEOUT_SECONDS)
    )

    _active_terminals += 1
    bridge: _PtyBridge | None = None
    resize_task: asyncio.Task | None = None
    try:
        try:
            bridge = _PtyBridge(cmd, cwd=_repo_root())
        except OSError as exc:
            logger.warning("Terminal spawn failed for %s: %s", username, exc)
            await _send_error(websocket, f"failed to spawn terminal: {exc}")
            with contextlib.suppress(Exception):
                await websocket.close(code=1011)
            return

        logger.info(
            "Terminal opened (user=%s mode=%s pid=%s)", username, mode, bridge.proc.pid
        )
        await websocket.send_json({"type": "ready", "mode": mode})

        if not override and mode == "shell":
            # new-session -A may have just created webterm; global option from
            # soren.sh usually covers it, but set it explicitly (best-effort).
            resize_task = asyncio.create_task(_set_aggressive_resize(WEBTERM_SESSION))

        pump_task = asyncio.create_task(_pump_output(bridge, websocket))
        client_task = asyncio.create_task(_client_loop(bridge, websocket, idle_timeout))
        try:
            # First completion wins: child EOF (pump) or disconnect/idle (client)
            await asyncio.wait(
                {pump_task, client_task}, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for task in (pump_task, client_task):
                task.cancel()
            await asyncio.gather(pump_task, client_task, return_exceptions=True)
    finally:
        # This block must tolerate task cancellation (test client / uvicorn
        # shutdown cancel WS handlers on disconnect): everything critical is
        # synchronous, the best-effort close comes last.
        _active_terminals -= 1
        if resize_task is not None:
            resize_task.cancel()
        if bridge is not None:
            bridge.close_now()
        if view_session is not None:
            # The viewport is disposable; the underlying soren session and
            # its windows are untouched by killing a grouped session.
            _tmux_kill_session_sync(view_session)
        logger.info("Terminal closed (user=%s mode=%s)", username, mode)
        with contextlib.suppress(Exception):
            await websocket.close()
