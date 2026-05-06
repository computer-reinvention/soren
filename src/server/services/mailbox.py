import asyncio
import aiofiles
import fcntl
from datetime import datetime, timezone
from typing import List, Optional
from collections import deque
import json
import uuid

from ..config import settings
from ..models.message import Message, TaskStatus
from .conversation_store import conversation_store
from ..middleware.redact import redact_sensitive


MAILBOX_LOCK_DIR = settings.soren_dir / "run"
MAILBOX_LOCK_DIR.mkdir(parents=True, exist_ok=True)
MAILBOX_LOCK_PATH = str(MAILBOX_LOCK_DIR / "mailbox.lock")


class MailboxService:
    def __init__(self):
        self.mailbox_path = settings.mailbox_path
        self._lock = asyncio.Lock()
        # In-memory message store for fast access (most recent messages)
        # SQLite provides durability across restarts
        self._messages: deque[Message] = deque(maxlen=200)
        # Load recent messages from SQLite on startup
        self._load_persisted_messages()

    def _load_persisted_messages(self):
        """Load recent messages from SQLite on startup."""
        try:
            messages = conversation_store.get_messages(limit=200)
            # Messages come in reverse order (newest first), reverse to get oldest first
            for msg in reversed(messages):
                self._messages.append(msg)
        except Exception:
            # Database might not exist yet on first run
            pass

    async def _ensure_mailbox(self):
        """Ensure mailbox file exists."""
        self.mailbox_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.mailbox_path.exists():
            self.mailbox_path.touch()

    async def send_to_supervisor(
        self,
        message_id: str,
        source: str,
        payload: dict
    ):
        """Send a message to the supervisor agent via mailbox.

        Uses JSONL format: one JSON object per line.
        The payload is written to a body file for the full content.
        """
        await self._ensure_mailbox()

        timestamp = datetime.now(timezone.utc).isoformat()
        from_addr = f"webhook:{source}"
        to_addr = "soren:supervisor"
        subject = f"[WEBHOOK] {source}"

        # Write payload to body file
        date_str = datetime.now().strftime("%Y-%m-%d")
        attachments_dir = settings.soren_dir / "journal" / date_str / "attachments"
        attachments_dir.mkdir(parents=True, exist_ok=True)
        body_path = attachments_dir / f"webhook-{message_id[:8]}.json"

        async with aiofiles.open(body_path, "w") as f:
            await f.write(json.dumps(payload, indent=2, default=str))

        # Write JSONL mailbox entry (with cross-process file lock)
        entry = json.dumps({
            "id": message_id,
            "ts": timestamp,
            "from": from_addr,
            "to": to_addr,
            "subject": subject,
            "body": str(body_path),
            "status": "submitted",
        }, separators=(",", ":"))

        async with self._lock:
            lock_file = open(MAILBOX_LOCK_PATH, "w")
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX)
                async with aiofiles.open(self.mailbox_path, "a") as f:
                    await f.write(entry + "\n")
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()

    async def send_mailbox_message(
        self,
        from_agent: str,
        to_agent: str,
        subject: str,
        body: str = ""
    ) -> str:
        """Send a message between agents via mailbox.

        Uses JSONL format: one JSON object per line.
        If body is provided, it's written to a file.
        """
        await self._ensure_mailbox()

        message_id = str(uuid.uuid4())
        timestamp = datetime.now(timezone.utc).isoformat()

        # Normalize addresses to session:agent format
        if ":" not in from_agent:
            from_addr = f"soren:{from_agent}"
        else:
            from_addr = from_agent

        if to_agent == "user":
            to_addr = "user"
        elif ":" not in to_agent:
            to_addr = f"soren:{to_agent}"
        else:
            to_addr = to_agent

        # Redact sensitive content before writing to the persistent mailbox file
        subject = redact_sensitive(subject)
        body = redact_sensitive(body) if body else body

        # Build JSONL entry
        entry_data = {
            "id": message_id,
            "ts": timestamp,
            "from": from_addr,
            "to": to_addr,
            "subject": subject,
            "status": "submitted",
        }

        if body:
            if len(body) > 1000:
                # Long body — write to attachment file
                date_str = datetime.now().strftime("%Y-%m-%d")
                attachments_dir = settings.soren_dir / "journal" / date_str / "attachments"
                attachments_dir.mkdir(parents=True, exist_ok=True)
                body_path = attachments_dir / f"msg-{message_id[:8]}.md"

                async with aiofiles.open(body_path, "w") as f:
                    await f.write(f"# {subject}\n\n{body}")

                entry_data["body"] = str(body_path)
            else:
                # Short body — inline it
                entry_data["body"] = body

        entry = json.dumps(entry_data, separators=(",", ":"))

        async with self._lock:
            lock_file = open(MAILBOX_LOCK_PATH, "w")
            try:
                fcntl.flock(lock_file, fcntl.LOCK_EX)
                async with aiofiles.open(self.mailbox_path, "a") as f:
                    await f.write(entry + "\n")
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()

        return message_id

    def store_message(self, message: Message, parent_message_id: str | None = None):
        """Store a message in memory and persist to SQLite."""
        self._messages.append(message)
        # Write-through to SQLite for persistence
        conversation_store.store_message(message, parent_message_id=parent_message_id)

    def update_message_status(self, message_id: str, status: TaskStatus) -> bool:
        """Update a message's task lifecycle status.

        Updates both the in-memory cache and the SQLite store.
        Returns True if the message was found and updated.
        """
        # Update in-memory
        for msg in self._messages:
            if msg.id == message_id:
                msg.task_status = status
                break
        # Update in SQLite (source of truth)
        return conversation_store.update_message_status(message_id, status)

    async def get_messages(
        self,
        limit: int = 50,
        offset: int = 0,
        agent_id: Optional[str] = None
    ) -> List[Message]:
        """Read messages from in-memory store for dashboard display."""
        messages = list(self._messages)

        # Filter by agent if specified
        if agent_id:
            messages = [m for m in messages
                       if m.from_agent == agent_id or m.to_agent == agent_id]

        # Return in reverse order (newest first) with pagination
        messages = list(reversed(messages))
        return messages[offset:offset + limit]


mailbox_service = MailboxService()
