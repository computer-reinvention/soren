from pydantic import BaseModel, Field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class MessageType(str, Enum):
    TASK = "task"
    STATUS = "status"
    RESPONSE = "response"
    ERROR = "error"
    USER = "user"
    MAILBOX = "mailbox"  # Agent-to-agent messages routed via mailbox
    SYSTEM = "system"  # System-level messages (heartbeat acks, compaction recovery, idle status)


class TaskStatus(str, Enum):
    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input-required"
    COMPLETED = "completed"
    VERIFIED = "verified"
    FAILED = "failed"


class Message(BaseModel):
    id: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    from_agent: str
    to_agent: str
    type: MessageType
    content: str
    metadata: Optional[dict] = None
    task_status: Optional[TaskStatus] = None
    parent_message_id: Optional[str] = None


class MessageList(BaseModel):
    messages: list[Message]
    total: int
    has_more: bool = False


class UserMessage(BaseModel):
    content: str
    from_agent: str = "supervisor"


class InternalMessage(BaseModel):
    """Message from router daemon for agent-to-agent communication."""
    from_agent: str
    to_agent: str
    content: str
    type: MessageType = MessageType.MAILBOX
    metadata: Optional[dict] = None
    task_status: Optional[TaskStatus] = None


class InboxResponse(BaseModel):
    """Response for the agent inbox endpoint."""
    pinned_task: Optional[Message] = None
    messages: list[Message]
    total: int


class StatusUpdateRequest(BaseModel):
    """Request to update a message's task lifecycle status."""
    status: TaskStatus
