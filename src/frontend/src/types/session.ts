export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'FAILED';

export interface Session {
  id: string;
  name: string;
  status: SessionStatus;
  supervisor_agent: string;
  task_description: string;
  template: string | null;
  is_main: boolean;
  created_at: string;
  agent_count: number;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

export interface SessionCreateRequest {
  name: string;
  task_description: string;
  template?: string;
}
