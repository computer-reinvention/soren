export type AgentEventType = 'PostToolUse' | 'Stop';

export interface AgentEvent {
  id: string;
  event_type: AgentEventType;
  session_id: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_output?: unknown;
  timestamp: string;
}

export interface AgentEventsResponse {
  events: AgentEvent[];
  total: number;
}

export interface AgentSession {
  session_id: string;
  event_count: number;
  last_event: string;
  last_event_type: AgentEventType;
}

export interface AgentSessionsResponse {
  sessions: AgentSession[];
}
