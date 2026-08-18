export interface TeamMember {
  name: string;
  in_registry: boolean;
  status: string | null;
  agent_id: string | null;
  display_name: string | null;
  role: string | null;
}

export interface Team {
  prefix: string;
  template: string;
  task: string;
  members: TeamMember[];
  project_id: string;
  permanent?: boolean;
  created_at: string;
}

export interface TeamList {
  teams: Team[];
  total: number;
}
