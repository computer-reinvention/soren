"""SQLite-based persistent storage for messages, agent events, and archived agents.

Provides durability across server restarts and archives worker conversations
before they are killed.
"""

import sqlite3
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from contextlib import contextmanager

from pydantic import BaseModel

from ..config import settings
from ..models.message import Message, MessageType, TaskStatus
from ..middleware.redact import redact_sensitive


class ArchivedAgent(BaseModel):
    """An archived agent with its terminal snapshot."""
    id: str
    agent_id: str
    agent_name: str
    agent_type: str
    archived_at: datetime
    terminal_output: Optional[str] = None


class ArchivedAgentSummary(BaseModel):
    """Summary of an archived agent (without terminal output)."""
    id: str
    agent_id: str
    agent_name: str
    agent_type: str
    archived_at: datetime


class ConversationStore:
    """SQLite-based persistent storage for messages and agent archives."""

    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = db_path or (settings.soren_dir / "conversations.db")
        self._ensure_db()

    def _ensure_db(self):
        """Create database and tables if they don't exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._get_connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    from_agent TEXT NOT NULL,
                    to_agent TEXT NOT NULL,
                    type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT,
                    task_status TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_messages_from_agent ON messages(from_agent);
                CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent);
                CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

                CREATE TABLE IF NOT EXISTS agent_archives (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    agent_name TEXT NOT NULL,
                    agent_type TEXT NOT NULL,
                    archived_at TEXT NOT NULL,
                    terminal_output TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_archives_agent_id ON agent_archives(agent_id);
                CREATE INDEX IF NOT EXISTS idx_archives_archived_at ON agent_archives(archived_at);

                CREATE TABLE IF NOT EXISTS agent_events (
                    id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    agent_id TEXT NOT NULL,
                    tool_name TEXT,
                    tool_input TEXT,
                    tool_output TEXT,
                    timestamp TEXT NOT NULL,
                    message_id TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events(session_id);
                CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent_id);
                CREATE INDEX IF NOT EXISTS idx_agent_events_message ON agent_events(message_id);
                CREATE INDEX IF NOT EXISTS idx_agent_events_timestamp ON agent_events(timestamp);

                CREATE TABLE IF NOT EXISTS thoughts (
                    id TEXT PRIMARY KEY,
                    agent_name TEXT NOT NULL,
                    thought_type TEXT NOT NULL,
                    content TEXT,
                    tool_name TEXT,
                    tool_input TEXT,
                    tool_response TEXT,
                    timestamp TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_thoughts_agent_name ON thoughts(agent_name);
                CREATE INDEX IF NOT EXISTS idx_thoughts_timestamp ON thoughts(timestamp);
            """)
            # Migration: add task_status column to existing databases
            columns = [row[1] for row in conn.execute("PRAGMA table_info(messages)").fetchall()]
            if "task_status" not in columns:
                conn.execute("ALTER TABLE messages ADD COLUMN task_status TEXT")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_task_status ON messages(task_status)")

            # Migration: add parent_message_id column
            if "parent_message_id" not in columns:
                conn.execute("ALTER TABLE messages ADD COLUMN parent_message_id TEXT")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_parent_message_id ON messages(parent_message_id)")

            # Migration: add usage column to agent_events
            event_columns = [row[1] for row in conn.execute("PRAGMA table_info(agent_events)").fetchall()]
            if "usage" not in event_columns:
                conn.execute("ALTER TABLE agent_events ADD COLUMN usage TEXT")

    @contextmanager
    def _get_connection(self):
        """Get a database connection with proper cleanup."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def store_message(self, message: Message, parent_message_id: Optional[str] = None) -> None:
        """Store a message in the database."""
        # Auto-detect task status from message content
        task_status = message.task_status
        content = message.content or ""
        stripped = content.strip()
        if not task_status:
            if stripped.startswith("[DONE]"):
                task_status = TaskStatus.COMPLETED
            elif "[VERIFY-FAILED]" in content:
                task_status = TaskStatus.FAILED
            elif "[VERIFIED]" in content:
                task_status = TaskStatus.VERIFIED
            elif stripped.startswith("[BLOCKED]"):
                task_status = TaskStatus.FAILED

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO messages
                (id, timestamp, from_agent, to_agent, type, content, metadata, task_status, parent_message_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id,
                    message.timestamp.isoformat(),
                    message.from_agent,
                    message.to_agent,
                    message.type.value,
                    redact_sensitive(message.content),
                    json.dumps(message.metadata) if message.metadata else None,
                    task_status.value if task_status else None,
                    parent_message_id,
                )
            )

    def count_messages(self, agent_id: Optional[str] = None) -> int:
        """Count total messages in the database, optionally filtered by agent."""
        with self._get_connection() as conn:
            if agent_id:
                cursor = conn.execute(
                    "SELECT COUNT(*) FROM messages WHERE from_agent = ? OR to_agent = ?",
                    (agent_id, agent_id),
                )
            else:
                cursor = conn.execute("SELECT COUNT(*) FROM messages")
            return cursor.fetchone()[0]

    def get_messages(
        self,
        limit: int = 50,
        offset: int = 0,
        agent_id: Optional[str] = None
    ) -> List[Message]:
        """Retrieve messages from the database."""
        with self._get_connection() as conn:
            if agent_id:
                cursor = conn.execute(
                    """
                    SELECT * FROM messages
                    WHERE from_agent = ? OR to_agent = ?
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                    """,
                    (agent_id, agent_id, limit, offset)
                )
            else:
                cursor = conn.execute(
                    """
                    SELECT * FROM messages
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset)
                )

            return [self._row_to_message(row) for row in cursor.fetchall()]

    def update_message_status(self, message_id: str, status: TaskStatus) -> bool:
        """Update the task_status of a message. Returns True if a row was updated."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                "UPDATE messages SET task_status = ? WHERE id = ?",
                (status.value, message_id),
            )
            return cursor.rowcount > 0

    def get_tasks(
        self,
        status: Optional[TaskStatus] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Message]:
        """Get messages that have a task_status, optionally filtered by status."""
        with self._get_connection() as conn:
            if status:
                cursor = conn.execute(
                    """
                    SELECT * FROM messages
                    WHERE task_status IS NOT NULL AND task_status = ?
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                    """,
                    (status.value, limit, offset),
                )
            else:
                cursor = conn.execute(
                    """
                    SELECT * FROM messages
                    WHERE task_status IS NOT NULL
                    ORDER BY timestamp DESC
                    LIMIT ? OFFSET ?
                    """,
                    (limit, offset),
                )

            return [self._row_to_message(row) for row in cursor.fetchall()]

    def archive_agent(
        self,
        agent_id: str,
        agent_name: str,
        agent_type: str,
        terminal_output: Optional[str] = None
    ) -> str:
        """Archive an agent with its terminal snapshot.

        Args:
            agent_id: The agent's unique identifier (usually same as name)
            agent_name: Human-readable name of the agent
            agent_type: 'worker' or 'supervisor'
            terminal_output: Terminal scrollback capture

        Returns:
            Archive ID
        """
        archive_id = str(uuid.uuid4())
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO agent_archives
                (id, agent_id, agent_name, agent_type, archived_at, terminal_output)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    archive_id,
                    agent_id,
                    agent_name,
                    agent_type,
                    datetime.now(timezone.utc).isoformat(),
                    terminal_output,
                )
            )
        return archive_id

    def get_archived_agents(self) -> List[ArchivedAgentSummary]:
        """Get list of all archived agents (without terminal output)."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, agent_id, agent_name, agent_type, archived_at
                FROM agent_archives
                ORDER BY archived_at DESC
                """
            )
            return [
                ArchivedAgentSummary(
                    id=row["id"],
                    agent_id=row["agent_id"],
                    agent_name=row["agent_name"],
                    agent_type=row["agent_type"],
                    archived_at=datetime.fromisoformat(row["archived_at"]),
                )
                for row in cursor.fetchall()
            ]

    def get_archive(self, archive_id: str) -> Optional[ArchivedAgent]:
        """Get a specific archive by ID (with terminal output)."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT * FROM agent_archives WHERE id = ?
                """,
                (archive_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return ArchivedAgent(
                id=row["id"],
                agent_id=row["agent_id"],
                agent_name=row["agent_name"],
                agent_type=row["agent_type"],
                archived_at=datetime.fromisoformat(row["archived_at"]),
                terminal_output=row["terminal_output"],
            )

    def get_archive_by_agent_id(self, agent_id: str) -> Optional[ArchivedAgent]:
        """Get the most recent archive for an agent ID."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT * FROM agent_archives
                WHERE agent_id = ?
                ORDER BY archived_at DESC
                LIMIT 1
                """,
                (agent_id,)
            )
            row = cursor.fetchone()
            if not row:
                return None
            return ArchivedAgent(
                id=row["id"],
                agent_id=row["agent_id"],
                agent_name=row["agent_name"],
                agent_type=row["agent_type"],
                archived_at=datetime.fromisoformat(row["archived_at"]),
                terminal_output=row["terminal_output"],
            )

    def get_messages_for_agent(self, agent_id: str, limit: int = 200) -> List[Message]:
        """Get all messages involving a specific agent."""
        return self.get_messages(limit=limit, agent_id=agent_id)

    def get_inbox(
        self,
        agent_id: str,
        limit: int = 200,
        offset: int = 0,
    ) -> tuple[Optional[Message], List[Message], int]:
        """Get inbox data for an agent: pinned task, messages, and total count.

        Returns:
            Tuple of (pinned_task, messages, total_count).
            pinned_task is the first [TASK] message sent TO this agent, or None.
            messages are ordered ASC (oldest first) for inbox view.
        """
        with self._get_connection() as conn:
            # 1. Pinned task: first [TASK] message sent TO this agent
            cursor = conn.execute(
                """
                SELECT * FROM messages
                WHERE to_agent = ? AND content LIKE '[TASK]%'
                ORDER BY timestamp ASC
                LIMIT 1
                """,
                (agent_id,),
            )
            pinned_row = cursor.fetchone()
            pinned_task = self._row_to_message(pinned_row) if pinned_row else None

            # 2. Total count of messages involving this agent
            cursor = conn.execute(
                "SELECT COUNT(*) FROM messages WHERE from_agent = ? OR to_agent = ?",
                (agent_id, agent_id),
            )
            total = cursor.fetchone()[0]

            # 3. Messages involving this agent, ordered ASC (oldest first)
            cursor = conn.execute(
                """
                SELECT * FROM messages
                WHERE from_agent = ? OR to_agent = ?
                ORDER BY timestamp ASC
                LIMIT ? OFFSET ?
                """,
                (agent_id, agent_id, limit, offset),
            )
            messages = [self._row_to_message(row) for row in cursor.fetchall()]

            return pinned_task, messages, total

    @staticmethod
    def _row_to_message(row: sqlite3.Row) -> Message:
        """Convert a database row to a Message model."""
        msg = Message(
            id=row["id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            from_agent=row["from_agent"],
            to_agent=row["to_agent"],
            type=MessageType(row["type"]),
            content=row["content"],
            metadata=json.loads(row["metadata"]) if row["metadata"] else None,
            task_status=TaskStatus(row["task_status"]) if row["task_status"] else None,
        )
        # Attach parent_message_id if column exists
        try:
            msg.parent_message_id = row["parent_message_id"]
        except (IndexError, KeyError):
            pass
        return msg

    # --- Agent Events ---

    def store_event(self, event_data: dict) -> None:
        """Store an agent event."""
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO agent_events
                (id, event_type, session_id, agent_id, tool_name, tool_input, tool_output, timestamp, message_id, usage)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_data["id"],
                    event_data["event_type"],
                    event_data["session_id"],
                    event_data["agent_id"],
                    event_data.get("tool_name"),
                    json.dumps(event_data.get("tool_input")) if event_data.get("tool_input") is not None else None,
                    json.dumps(event_data.get("tool_output")) if event_data.get("tool_output") is not None else None,
                    event_data["timestamp"],
                    event_data.get("message_id"),
                    json.dumps(event_data.get("usage")) if event_data.get("usage") is not None else None,
                ),
            )

    def link_events_to_message(self, agent_id: str, message_id: str, since_event_id: Optional[str] = None) -> int:
        """Link unlinked tool call events for an agent to a message.

        Finds all events for this agent that have no message_id set
        (i.e. tool calls between the last Stop and this Stop) and sets their message_id.

        Returns the number of events linked.
        """
        with self._get_connection() as conn:
            if since_event_id:
                # Link events after a specific event ID
                cursor = conn.execute(
                    """
                    UPDATE agent_events
                    SET message_id = ?
                    WHERE agent_id = ?
                      AND message_id IS NULL
                      AND event_type = 'PostToolUse'
                      AND timestamp >= (SELECT timestamp FROM agent_events WHERE id = ?)
                    """,
                    (message_id, agent_id, since_event_id),
                )
            else:
                # Link all unlinked tool call events for this agent
                cursor = conn.execute(
                    """
                    UPDATE agent_events
                    SET message_id = ?
                    WHERE agent_id = ?
                      AND message_id IS NULL
                      AND event_type = 'PostToolUse'
                    """,
                    (message_id, agent_id),
                )
            return cursor.rowcount

    def get_events_by_message(self, message_id: str) -> list[dict]:
        """Get all agent events linked to a specific message."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT * FROM agent_events
                WHERE message_id = ?
                ORDER BY timestamp ASC
                """,
                (message_id,),
            )
            return [self._row_to_event(row) for row in cursor.fetchall()]

    def get_events(
        self,
        session_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Get recent agent events with optional filters."""
        with self._get_connection() as conn:
            conditions = []
            params: list = []

            if session_id:
                conditions.append("session_id = ?")
                params.append(session_id)
            if agent_id:
                conditions.append("agent_id = ?")
                params.append(agent_id)

            where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
            params.append(limit)

            cursor = conn.execute(
                f"""
                SELECT * FROM agent_events
                {where}
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                params,
            )
            return [self._row_to_event(row) for row in cursor.fetchall()]

    def get_event_sessions(self) -> list[dict]:
        """List all sessions that have sent events."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                """
                SELECT session_id,
                       COUNT(*) as event_count,
                       MAX(timestamp) as last_event,
                       (SELECT event_type FROM agent_events e2
                        WHERE e2.session_id = e1.session_id
                        ORDER BY timestamp DESC LIMIT 1) as last_event_type
                FROM agent_events e1
                GROUP BY session_id
                ORDER BY last_event DESC
                """
            )
            return [
                {
                    "session_id": row["session_id"],
                    "event_count": row["event_count"],
                    "last_event": row["last_event"],
                    "last_event_type": row["last_event_type"],
                }
                for row in cursor.fetchall()
            ]

    # --- Thoughts ---

    def store_thought(self, thought_data: dict) -> None:
        """Store an agent thought."""
        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO thoughts
                (id, agent_name, thought_type, content, tool_name, tool_input, tool_response, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    thought_data["id"],
                    thought_data["agent_name"],
                    thought_data["thought_type"],
                    thought_data.get("content"),
                    thought_data.get("tool_name"),
                    thought_data.get("tool_input"),
                    thought_data.get("tool_response"),
                    thought_data["timestamp"],
                ),
            )

    def get_thoughts(
        self,
        agent_name: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        """Get recent thoughts with optional agent_name filter."""
        with self._get_connection() as conn:
            conditions = []
            params: list = []

            if agent_name:
                conditions.append("agent_name = ?")
                params.append(agent_name)

            where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
            params.append(limit)

            cursor = conn.execute(
                f"""
                SELECT * FROM thoughts
                {where}
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                params,
            )
            return [self._row_to_thought(row) for row in cursor.fetchall()]

    @staticmethod
    def _row_to_thought(row: sqlite3.Row) -> dict:
        """Convert a database row to a thought dict."""
        return {
            "id": row["id"],
            "agent_name": row["agent_name"],
            "thought_type": row["thought_type"],
            "content": row["content"],
            "tool_name": row["tool_name"],
            "tool_input": row["tool_input"],
            "tool_response": row["tool_response"],
            "timestamp": row["timestamp"],
        }

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> dict:
        """Convert a database row to an event dict."""
        result = {
            "id": row["id"],
            "event_type": row["event_type"],
            "session_id": row["session_id"],
            "agent_id": row["agent_id"],
            "tool_name": row["tool_name"],
            "tool_input": json.loads(row["tool_input"]) if row["tool_input"] else None,
            "tool_output": json.loads(row["tool_output"]) if row["tool_output"] else None,
            "timestamp": row["timestamp"],
            "message_id": row["message_id"],
        }
        # usage column may not exist in older databases before migration runs
        try:
            result["usage"] = json.loads(row["usage"]) if row["usage"] else None
        except (IndexError, KeyError):
            result["usage"] = None
        return result

    # --- Budget / Token Usage ---

    # Agent ID prefixes created by the test suite — excluded from production
    # budget queries so test runs don't inflate real cost figures.
    _TEST_AGENT_PREFIXES = ("qual-", "worker-budget-", "test-")

    @staticmethod
    def _test_prefix_filter(col: str = "agent_id") -> str:
        """Return SQL AND clause excluding test-prefixed agent IDs."""
        parts = " AND ".join(
            f"{col} NOT LIKE '{p}%'"
            for p in ConversationStore._TEST_AGENT_PREFIXES
        )
        return f"AND {parts}"

    def get_budget_summary(self) -> list[dict]:
        """Get per-agent token usage totals from events with usage data.

        Usage values in agent_events are CUMULATIVE per session (each Stop
        event reports the running total, not a delta).  We take the LATEST
        event per (agent, session) to get each session's total, then SUM
        across sessions per agent.  This correctly counts tokens when agents
        respawn with a new session_id.

        Test-prefixed agents (qual-*, worker-budget-*, test-*) are excluded.
        """
        exclude = self._test_prefix_filter()
        with self._get_connection() as conn:
            cursor = conn.execute(
                f"""
                SELECT
                    agent_id,
                    SUM(event_count)          as event_count,
                    SUM(input_tokens)         as input_tokens,
                    SUM(output_tokens)        as output_tokens,
                    SUM(cache_read_tokens)    as cache_read_tokens,
                    SUM(cache_creation_tokens) as cache_creation_tokens
                FROM (
                    SELECT
                        agent_id,
                        COUNT(*) OVER (PARTITION BY agent_id, session_id) as event_count,
                        json_extract(usage, '$.input_tokens')              as input_tokens,
                        json_extract(usage, '$.output_tokens')             as output_tokens,
                        json_extract(usage, '$.cache_read_input_tokens')   as cache_read_tokens,
                        json_extract(usage, '$.cache_creation_input_tokens') as cache_creation_tokens,
                        ROW_NUMBER() OVER (PARTITION BY agent_id, session_id ORDER BY timestamp DESC) as rn
                    FROM agent_events
                    WHERE usage IS NOT NULL {exclude}
                )
                WHERE rn = 1
                GROUP BY agent_id
                ORDER BY input_tokens DESC
                """
            )
            return [
                {
                    "agent_id": row["agent_id"],
                    "input_tokens": row["input_tokens"] or 0,
                    "output_tokens": row["output_tokens"] or 0,
                    "cache_read_tokens": row["cache_read_tokens"] or 0,
                    "cache_creation_tokens": row["cache_creation_tokens"] or 0,
                    "event_count": row["event_count"],
                }
                for row in cursor.fetchall()
            ]

    def get_daily_budget(self) -> list[dict]:
        """Get per-day token usage totals grouped by date.

        Usage values are CUMULATIVE per agent session.  We take the LATEST
        event per (agent, session, day) to get each session's daily total,
        then SUM across all agent-sessions for each calendar day.  This
        correctly counts tokens when agents respawn with new session_ids.

        Test-prefixed agents (qual-*, worker-budget-*, test-*) are excluded.
        """
        exclude = self._test_prefix_filter()
        with self._get_connection() as conn:
            cursor = conn.execute(
                f"""
                SELECT
                    date,
                    SUM(event_count)     as event_count,
                    SUM(input_tokens)    as input_tokens,
                    SUM(output_tokens)   as output_tokens,
                    SUM(cache_read_tokens)    as cache_read_tokens,
                    SUM(cache_creation_tokens) as cache_creation_tokens
                FROM (
                    SELECT
                        date(timestamp) as date,
                        COUNT(*) OVER (PARTITION BY agent_id, session_id, date(timestamp)) as event_count,
                        json_extract(usage, '$.input_tokens')              as input_tokens,
                        json_extract(usage, '$.output_tokens')             as output_tokens,
                        json_extract(usage, '$.cache_read_input_tokens')   as cache_read_tokens,
                        json_extract(usage, '$.cache_creation_input_tokens') as cache_creation_tokens,
                        ROW_NUMBER() OVER (
                            PARTITION BY agent_id, session_id, date(timestamp)
                            ORDER BY timestamp DESC
                        ) as rn
                    FROM agent_events
                    WHERE usage IS NOT NULL {exclude}
                )
                WHERE rn = 1
                GROUP BY date
                ORDER BY date DESC
                """
            )
            return [
                {
                    "date": row["date"],
                    "input_tokens": row["input_tokens"] or 0,
                    "output_tokens": row["output_tokens"] or 0,
                    "cache_read_tokens": row["cache_read_tokens"] or 0,
                    "cache_creation_tokens": row["cache_creation_tokens"] or 0,
                    "event_count": row["event_count"],
                }
                for row in cursor.fetchall()
            ]

    def get_agent_budget(self, agent_id: str, limit: int = 50) -> dict:
        """Get token usage detail for a single agent.

        Usage values are CUMULATIVE per session.  We take the latest event
        per session to get each session's total, then SUM across sessions.
        event_count reflects the true number of recorded usage events.
        """
        with self._get_connection() as conn:
            # Totals — latest event per session, then sum across sessions
            cursor = conn.execute(
                """
                SELECT
                    SUM(event_count)          as event_count,
                    SUM(input_tokens)         as input_tokens,
                    SUM(output_tokens)        as output_tokens,
                    SUM(cache_read_tokens)    as cache_read_tokens,
                    SUM(cache_creation_tokens) as cache_creation_tokens
                FROM (
                    SELECT
                        COUNT(*) OVER (PARTITION BY session_id) as event_count,
                        json_extract(usage, '$.input_tokens')              as input_tokens,
                        json_extract(usage, '$.output_tokens')             as output_tokens,
                        json_extract(usage, '$.cache_read_input_tokens')   as cache_read_tokens,
                        json_extract(usage, '$.cache_creation_input_tokens') as cache_creation_tokens,
                        ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp DESC) as rn
                    FROM agent_events
                    WHERE agent_id = ? AND usage IS NOT NULL
                )
                WHERE rn = 1
                """,
                (agent_id,),
            )
            row = cursor.fetchone()
            totals = {
                "agent_id": agent_id,
                "input_tokens": row["input_tokens"] or 0 if row else 0,
                "output_tokens": row["output_tokens"] or 0 if row else 0,
                "cache_read_tokens": row["cache_read_tokens"] or 0 if row else 0,
                "cache_creation_tokens": row["cache_creation_tokens"] or 0 if row else 0,
                "event_count": row["event_count"] or 0 if row else 0,
            }

            # Recent events with usage
            cursor = conn.execute(
                """
                SELECT * FROM agent_events
                WHERE agent_id = ? AND usage IS NOT NULL
                ORDER BY timestamp DESC
                LIMIT ?
                """,
                (agent_id, limit),
            )
            events = [self._row_to_event(r) for r in cursor.fetchall()]

            return {"totals": totals, "recent_events": events}


# Singleton instance
conversation_store = ConversationStore()
