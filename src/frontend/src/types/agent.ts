export type AgentStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'BLOCKED'
  | 'TESTING'
  | 'COMPLETE'
  | 'FAILED'
  | 'IDLE'
  | 'SLEEPING';

export type AgentType = 'supervisor' | 'worker';

export interface Agent {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  tmux_window: string;
  session: string;
  created_at: string;
  last_activity: string | null;
  current_task: string | null;
  display_name?: string;
  role?: string;
  project_id?: string;
  permanent?: boolean;
  role_context?: string;
  reset_count?: number;
  tasks_since_reset?: number;
  clone_of?: string;
  worktree_branch?: string;
}

export interface AgentListResponse {
  agents: Agent[];
  total: number;
}

export interface ArchivedAgentSummary {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_type: AgentType;
  archived_at: string;
}

export interface ArchivedAgent extends ArchivedAgentSummary {
  terminal_output: string | null;
}
