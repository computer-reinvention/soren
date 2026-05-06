from pydantic import BaseModel, Field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Any


class AgentEventType(str, Enum):
    USER_PROMPT_SUBMIT = "UserPromptSubmit"
    POST_TOOL_USE = "PostToolUse"
    STOP = "Stop"


class AgentEvent(BaseModel):
    """Event received from Claude Code hooks."""

    event_type: AgentEventType
    session_id: str
    agent_id: Optional[str] = None  # Human-readable agent name from SOREN_AGENT_NAME
    tool_name: Optional[str] = None
    tool_input: Optional[Any] = None
    tool_output: Optional[Any] = None
    transcript_path: Optional[str] = None
    response_content: Optional[str] = None  # Agent's response text (extracted from transcript on Stop)
    usage: Optional[dict] = None  # Token usage: {input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AgentEventResponse(BaseModel):
    """Response after receiving an agent event."""

    success: bool
    event_id: str
    message: str = "Event received"
