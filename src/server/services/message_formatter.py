"""
Centralized message formatting for agent communication.

All messages sent to agents should use this format so agents can:
1. Know where the message came from
2. Know who sent it
3. Respond appropriately based on context
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
import uuid


class MessageSource(str, Enum):
    """Source of the message."""
    DASHBOARD = "dashboard"      # From web frontend
    MAILBOX = "mailbox"          # From mailbox router (agent-to-agent)
    WEBHOOK = "webhook"          # From external webhook
    SYSTEM = "system"            # From system/monitor
    TERMINAL = "terminal"        # Direct terminal (rare)


class MessageType(str, Enum):
    """Type of message."""
    TASK = "task"                # A task to be done
    STATUS = "status"            # Status update
    RESPONSE = "response"        # Response to a previous message
    QUESTION = "question"        # Question requiring answer
    ERROR = "error"              # Error notification


def format_agent_message(
    content: str,
    source: MessageSource,
    sender: str,
    msg_type: MessageType = MessageType.TASK,
    msg_id: Optional[str] = None,
    include_timestamp: bool = True
) -> str:
    """
    Format a message for delivery to an agent.

    This creates a standardized message envelope that agents can parse
    to understand context about the message.

    Args:
        content: The actual message content
        source: Where the message originated (dashboard, mailbox, etc.)
        sender: Who sent it (user, agent name, webhook name)
        msg_type: Type of message (task, status, response, etc.)
        msg_id: Optional message ID for tracking
        include_timestamp: Whether to include timestamp (default True)

    Returns:
        Formatted message string
    """
    msg_id = msg_id or str(uuid.uuid4())[:8]

    lines = ["--- MESSAGE ---"]

    if include_timestamp:
        lines.append(f"timestamp: {datetime.now(timezone.utc).isoformat()}")

    lines.append(f"from: {source.value}:{sender}")
    lines.append(f"type: {msg_type.value}")
    lines.append(f"id: {msg_id}")
    lines.append("---")
    lines.append(content)

    return "\n".join(lines)


def format_dashboard_message(content: str, user: str = "user") -> str:
    """Convenience function for dashboard messages."""
    return format_agent_message(
        content=content,
        source=MessageSource.DASHBOARD,
        sender=user,
        msg_type=MessageType.TASK
    )


def format_agent_to_agent_message(
    content: str,
    from_agent: str,
    msg_type: MessageType = MessageType.TASK
) -> str:
    """Convenience function for agent-to-agent messages via mailbox."""
    return format_agent_message(
        content=content,
        source=MessageSource.MAILBOX,
        sender=from_agent,
        msg_type=msg_type
    )


def format_webhook_message(content: str, webhook_source: str) -> str:
    """Convenience function for webhook messages."""
    return format_agent_message(
        content=content,
        source=MessageSource.WEBHOOK,
        sender=webhook_source,
        msg_type=MessageType.TASK
    )


def format_system_message(content: str, msg_type: MessageType = MessageType.STATUS) -> str:
    """Convenience function for system messages."""
    return format_agent_message(
        content=content,
        source=MessageSource.SYSTEM,
        sender="monitor",
        msg_type=msg_type
    )
