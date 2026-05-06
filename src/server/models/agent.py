from pydantic import BaseModel, Field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class AgentStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    TESTING = "TESTING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"
    IDLE = "IDLE"
    SLEEPING = "SLEEPING"


class AgentType(str, Enum):
    SUPERVISOR = "supervisor"
    WORKER = "worker"


class AgentRole(str, Enum):
    WORKER = "worker"
    SUPERVISOR = "supervisor"
    PROJECT_SUPERVISOR = "project-supervisor"


class Agent(BaseModel):
    id: str  # window-based ID for backward compat (e.g. "supervisor", "soren:worker-1")
    agent_id: Optional[str] = None  # unique agent ID (e.g. "ag_0000prim", "ag_7f3k2m9p")
    name: str  # tmux window name
    display_name: Optional[str] = None  # human-readable name (defaults to name)
    type: AgentType
    role: AgentRole = AgentRole.WORKER
    status: AgentStatus = AgentStatus.IDLE
    project_id: str = "soren"
    permanent: bool = False
    keep_awake: bool = False
    role_context: Optional[str] = None
    clone_of: Optional[str] = None
    clone_index: Optional[int] = None
    worktree_branch: Optional[str] = None
    reset_count: int = 0
    tasks_since_reset: int = 0
    tmux_window: str
    session: str = "soren"  # tmux session this agent belongs to
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_activity: Optional[datetime] = None
    current_task: Optional[str] = None


class AgentList(BaseModel):
    agents: list[Agent]
    total: int


class AgentMessage(BaseModel):
    content: str
    priority: int = Field(default=0, ge=0, le=10)
