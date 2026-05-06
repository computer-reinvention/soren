from pydantic import BaseModel, Field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class SessionStatus(str, Enum):
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Session(BaseModel):
    id: str  # e.g., "soren" or "soren-feature-auth"
    name: str  # Human-readable name
    status: SessionStatus = SessionStatus.ACTIVE
    supervisor_agent: str  # Window name of the supervisor
    task_description: str = ""  # What this session is for
    template: Optional[str] = None  # Template doc used (e.g., "FEATURE_SUPERVISOR")
    is_main: bool = False  # Whether this is the immortal main session
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    agent_count: int = 0  # Number of agents in session (computed)


class SessionCreate(BaseModel):
    name: str  # Will be prefixed with "soren-"
    task_description: str
    template: Optional[str] = None  # Template name without .md extension


class SessionList(BaseModel):
    sessions: list[Session]
    total: int


class SessionMessage(BaseModel):
    content: str
