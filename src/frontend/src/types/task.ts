export interface Task {
  id: string;
  title: string;
  description: string;
  project: string;
  assigned_to: string;
  status: string;
  priority: string;
  source: string;
  linked_workers: string;
  parent_id: string;
  resources: string[];
  created_at: string;
  updated_at: string;
  completed_at: string;
  remarks: string;
  children?: Task[];
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface TaskTreeResponse {
  tasks: Task[];
  total: number;
}

export interface TaskStatsResponse {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_assignee: Record<string, number>;
  needs_attention: Task[];
}

export type TaskStatus = 'backlog' | 'pending' | 'assigned' | 'in-progress' | 'review' | 'done' | 'blocked' | 'failed';
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskSource = 'user' | 'backlog' | 'self-generated' | 'worker-escalation' | 'system';
