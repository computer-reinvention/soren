import type { AgentListResponse, Agent, ArchivedAgentSummary, ArchivedAgent } from '../types/agent';
import type { MessageListResponse } from '../types/message';
import type { AgentEventsResponse } from '../types/agent_event';
import type { JournalDayResponse, JournalDatesResponse, JournalSearchResponse, JournalTeamsResponse, JournalScopeParams, JournalEntryCreate, RecurringIssuesResponse, WeeklySummaryResponse, CorrectionComplianceResponse } from '../types/journal';
import type { FilesystemResponse } from '../types/filesystem';
import type { SessionListResponse, Session, SessionCreateRequest } from '../types/session';
import type { ProjectList, Project, ProjectCreate, ProjectAgentsResponse } from '../types/project';
import type { TeamList, Team } from '../types/team';
import type { TaskListResponse, TaskTreeResponse, TaskStatsResponse, Task, TaskDagResponse } from '../types/task';
import type { MemorySearchResponse, MemoryStatsResponse } from '../types/memory';
import { API_BASE } from './constants';
import { useAuthStore } from '../stores/authStore';

export interface BudgetAgentUsage {
  agent_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  event_count: number;
  /**
   * Real USD cost straight from opencode's own session database where
   * available (the exact number its own TUI status bar shows), falling
   * back to a token-based estimate only for sessions it has no record of.
   * Always trust this field over recomputing from the token counts above
   * — see src/server/services/opencode_transcripts.py.
   */
  cost_usd: number;
}

export interface BudgetResponse {
  agents: BudgetAgentUsage[];
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestionItem {
  question: string;
  header?: string;
  /** True if this question accepts multiple selected options at once. */
  multiple?: boolean;
  options: QuestionOption[];
}

export interface PendingQuestion {
  call_id: string;
  /** opencode's `question` tool accepts an array of questions per call,
   * though in practice every real example observed so far has exactly one. */
  questions: PendingQuestionItem[];
}

export interface PendingQuestionResponse {
  agent_id: string;
  pending_question: PendingQuestion | null;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded';
  api: string;
  frontend: { status: string; index_exists: boolean; js_bundle_count: number };
  timestamp: string;
}

// Authenticated fetch wrapper — adds credentials + Bearer token, handles 401
async function apiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('soren_token');
  const headers = new Headers(options.headers as HeadersInit);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (res.status === 401) {
    // Clear stored token — AuthGuard will show LoginPage on next render
    localStorage.removeItem('soren_token');
    useAuthStore.setState({ username: null, token: null, isAuthenticated: false, isLoading: false });
  }

  return res;
}

export const api = {
  async getAgents(): Promise<AgentListResponse> {
    const res = await apiFetch(`${API_BASE}/api/agents`);
    if (!res.ok) throw new Error('Failed to fetch agents');
    return res.json();
  },

  async getAgent(id: string): Promise<Agent> {
    const res = await apiFetch(`${API_BASE}/api/agents/${id}`);
    if (!res.ok) throw new Error('Failed to fetch agent');
    return res.json();
  },

  async sendMessageToAgent(agentId: string, content: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      // 503 means tmux delivery genuinely failed (agent asleep/crashed/
      // window gone) — surface the backend's specific reason instead of a
      // generic "failed to send", since "agent isn't reachable right now"
      // is actionable in a way "failed to send" isn't.
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || 'Failed to send message');
    }
  },

  async interruptAgent(agentId: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/interrupt`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to interrupt agent');
  },

  async wakeAgent(agentId: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/wake`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to wake agent');
  },

  async compactAgent(agentId: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/compact`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to compact agent');
  },

  async getPendingQuestion(agentId: string): Promise<PendingQuestionResponse> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/pending-question`);
    if (!res.ok) throw new Error('Failed to fetch pending question');
    return res.json();
  },

  async getAgentTerminal(agentId: string, lines = 50): Promise<{ agent_id: string; output: string; lines: number }> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/terminal?lines=${lines}`);
    if (!res.ok) throw new Error('Failed to get terminal output');
    return res.json();
  },

  async getMessages(limit = 50, offset = 0, agentId?: string): Promise<MessageListResponse> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (agentId) params.set('agent_id', agentId);
    const res = await apiFetch(`${API_BASE}/api/messages?${params}`);
    if (!res.ok) throw new Error('Failed to fetch messages');
    return res.json();
  },

  async getMailboxMessages(limit = 10): Promise<MessageListResponse> {
    const res = await apiFetch(
      `${API_BASE}/api/messages?limit=${limit}&offset=0`
    );
    if (!res.ok) throw new Error('Failed to fetch mailbox messages');
    const data: MessageListResponse = await res.json();
    const mailboxMessages = data.messages.filter(m => m.type === 'mailbox');
    return { messages: mailboxMessages, total: mailboxMessages.length, has_more: false };
  },

  async getAgentEvents(sessionId?: string, limit = 50): Promise<AgentEventsResponse> {
    const params = new URLSearchParams();
    if (sessionId) params.set('session_id', sessionId);
    params.set('limit', String(limit));
    const res = await apiFetch(`${API_BASE}/api/agent-events?${params}`);
    if (!res.ok) throw new Error('Failed to fetch agent events');
    return res.json();
  },

  async getEventsByMessage(messageId: string): Promise<AgentEventsResponse> {
    const res = await apiFetch(`${API_BASE}/api/agent-events/by-message/${encodeURIComponent(messageId)}`);
    if (!res.ok) throw new Error('Failed to fetch events for message');
    return res.json();
  },

  async getEventsByMessages(messageIds: string[]): Promise<Record<string, AgentEventsResponse['events']>> {
    const res = await apiFetch(`${API_BASE}/api/agent-events/by-messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_ids: messageIds }),
    });
    if (!res.ok) throw new Error('Failed to fetch events for messages');
    const data = await res.json();
    return data.events_by_message;
  },

  async getJournal(date?: string, opts?: JournalScopeParams & { project?: string }): Promise<JournalDayResponse> {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    if (opts?.project) params.set('project', opts.project);
    if (opts?.scope) params.set('scope', opts.scope);
    if (opts?.team) params.set('team', opts.team);
    const qs = params.toString();
    const res = await apiFetch(`${API_BASE}/api/journal${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Failed to fetch journal');
    return res.json();
  },

  async getJournalDates(opts?: JournalScopeParams): Promise<JournalDatesResponse> {
    const params = new URLSearchParams();
    if (opts?.scope) params.set('scope', opts.scope);
    if (opts?.team) params.set('team', opts.team);
    const qs = params.toString();
    const res = await apiFetch(`${API_BASE}/api/journal/dates${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error('Failed to fetch journal dates');
    return res.json();
  },

  // Team prefixes that have their own journal — populates the scope
  // selector. Dashboard/oversight only; not used by any agent-facing tool.
  async getJournalTeams(): Promise<JournalTeamsResponse> {
    const res = await apiFetch(`${API_BASE}/api/journal/teams`);
    if (!res.ok) throw new Error('Failed to fetch journal teams');
    return res.json();
  },

  async searchJournal(
    query: string,
    limit = 20,
    opts?: JournalScopeParams & { all?: boolean }
  ): Promise<JournalSearchResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (opts?.scope) params.set('scope', opts.scope);
    if (opts?.team) params.set('team', opts.team);
    if (opts?.all) params.set('all', 'true');
    const res = await apiFetch(`${API_BASE}/api/journal/search?${params}`);
    if (!res.ok) throw new Error('Failed to search journal');
    return res.json();
  },

  // P5.4 — semantic memory search (automatic pipeline, see
  // .opencode/skills/memory/SKILL.md), surfaced as another CommandPalette
  // search group rather than a separate dialog (see CommandPalette.tsx).
  async searchMemory(query: string, limit = 5, projectId?: string): Promise<MemorySearchResponse> {
    const res = await apiFetch(`${API_BASE}/api/memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit, project_id: projectId ?? null }),
    });
    if (!res.ok) throw new Error('Failed to search memory');
    return res.json();
  },

  async getMemoryStats(): Promise<MemoryStatsResponse> {
    const res = await apiFetch(`${API_BASE}/api/memory/stats`);
    if (!res.ok) throw new Error('Failed to fetch memory stats');
    return res.json();
  },

  // team: narrow a supervisor/dashboard-level aggregate view to one team,
  // rather than every team + the supervisor journal combined (the default).
  async getRecurringIssues(team?: string): Promise<RecurringIssuesResponse> {
    const params = team ? `?team=${encodeURIComponent(team)}` : '';
    const res = await apiFetch(`${API_BASE}/api/journal/recurring-issues${params}`);
    if (!res.ok) throw new Error('Failed to fetch recurring issues');
    return res.json();
  },

  async getCorrectionCompliance(team?: string): Promise<CorrectionComplianceResponse> {
    const params = team ? `?team=${encodeURIComponent(team)}` : '';
    const res = await apiFetch(`${API_BASE}/api/journal/correction-compliance${params}`);
    if (!res.ok) throw new Error('Failed to fetch correction compliance');
    return res.json();
  },

  async getWeeklySummary(weeksAgo = 0, team?: string): Promise<WeeklySummaryResponse> {
    const params = new URLSearchParams({ weeks_ago: String(weeksAgo) });
    if (team) params.set('team', team);
    const res = await apiFetch(`${API_BASE}/api/journal/weekly-summary?${params}`);
    if (!res.ok) throw new Error('Failed to fetch weekly summary');
    return res.json();
  },

  async addJournalEntry(entry: JournalEntryCreate): Promise<{ success: boolean }> {
    const res = await apiFetch(`${API_BASE}/api/journal/entry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error('Failed to add journal entry');
    return res.json();
  },

  async getFilesystem(path?: string): Promise<FilesystemResponse> {
    const params = path ? `?path=${encodeURIComponent(path)}` : '';
    const res = await apiFetch(`${API_BASE}/api/filesystem${params}`);
    if (!res.ok) throw new Error('Failed to fetch filesystem');
    return res.json();
  },

  async getFileContent(path: string): Promise<string> {
    const res = await apiFetch(`${API_BASE}/api/filesystem/content?path=${encodeURIComponent(path)}`);
    if (!res.ok) throw new Error('Failed to fetch file content');
    const data = await res.json();
    return data.content;
  },

  // Session API
  async getSessions(): Promise<SessionListResponse> {
    const res = await apiFetch(`${API_BASE}/api/sessions`);
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return res.json();
  },

  async getSession(id: string): Promise<Session> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}`);
    if (!res.ok) throw new Error('Failed to fetch session');
    return res.json();
  },

  async createSession(data: SessionCreateRequest): Promise<Session> {
    const res = await apiFetch(`${API_BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create session');
    return res.json();
  },

  async terminateSession(id: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      if (res.status === 403) throw new Error('Cannot terminate main session');
      throw new Error('Failed to terminate session');
    }
  },

  async pauseSession(id: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}/pause`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to pause session');
  },

  async resumeSession(id: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}/resume`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to resume session');
  },

  async clearSession(id: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}/clear`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to clear session');
  },

  async sendMessageToSession(id: string, content: string): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/sessions/${id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) throw new Error('Failed to send message to session');
  },

  // Archived agents API
  async getArchivedAgents(): Promise<ArchivedAgentSummary[]> {
    const res = await apiFetch(`${API_BASE}/api/agents/archived`);
    if (!res.ok) throw new Error('Failed to fetch archived agents');
    return res.json();
  },

  async getArchivedAgent(archiveId: string): Promise<ArchivedAgent> {
    const res = await apiFetch(`${API_BASE}/api/agents/archived/${archiveId}`);
    if (!res.ok) throw new Error('Failed to fetch archived agent');
    return res.json();
  },

  async archiveAgent(agentId: string): Promise<{ archive_id: string }> {
    const res = await apiFetch(`${API_BASE}/api/agents/${agentId}/archive`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to archive agent');
    return res.json();
  },

  // Project API
  async getProjects(): Promise<ProjectList> {
    const res = await apiFetch(`${API_BASE}/api/projects`);
    if (!res.ok) throw new Error('Failed to fetch projects');
    return res.json();
  },

  async createProject(data: ProjectCreate): Promise<Project> {
    const res = await apiFetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to create project');
    return res.json();
  },

  async getProjectAgents(projectId: string): Promise<ProjectAgentsResponse> {
    const res = await apiFetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/agents`);
    if (!res.ok) throw new Error('Failed to fetch project agents');
    return res.json();
  },

  // Teams API
  async getTeams(): Promise<TeamList> {
    const res = await apiFetch(`${API_BASE}/api/teams`);
    if (!res.ok) throw new Error('Failed to fetch teams');
    return res.json();
  },

  async getTeam(prefix: string): Promise<Team> {
    const res = await apiFetch(`${API_BASE}/api/teams/${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error('Failed to fetch team');
    return res.json();
  },

  async activateProject(projectId: string): Promise<{ success: boolean }> {
    const res = await apiFetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}/activate`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to activate project');
    return res.json();
  },

  async getThoughts(limit = 200, agentName?: string): Promise<{ thoughts: Array<{
    id: string;
    agent_name: string;
    thought_type: string;
    content?: string | null;
    tool_name?: string | null;
    tool_input?: string | null;
    tool_response?: string | null;
    timestamp: string;
  }>; count: number }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (agentName) params.set('agent_name', agentName);
    const res = await apiFetch(`${API_BASE}/api/thoughts?${params}`);
    if (!res.ok) throw new Error('Failed to fetch thoughts');
    return res.json();
  },

  // Tasks API
  async getTasks(params?: { project?: string; status?: string; assigned_to?: string; include_done?: boolean }): Promise<TaskListResponse> {
    const qs = new URLSearchParams();
    if (params?.project) qs.set('project', params.project);
    if (params?.status) qs.set('status', params.status);
    if (params?.assigned_to) qs.set('assigned_to', params.assigned_to);
    if (params?.include_done) qs.set('include_done', 'true');
    const query = qs.toString();
    const res = await apiFetch(`${API_BASE}/api/tasks${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error('Failed to fetch tasks');
    return res.json();
  },

  async getTaskTree(params?: { project?: string; include_done?: boolean }): Promise<TaskTreeResponse> {
    const qs = new URLSearchParams();
    if (params?.project) qs.set('project', params.project);
    if (params?.include_done) qs.set('include_done', 'true');
    const query = qs.toString();
    const res = await apiFetch(`${API_BASE}/api/tasks/tree${query ? `?${query}` : ''}`);
    if (!res.ok) throw new Error('Failed to fetch task tree');
    return res.json();
  },

  async getTask(taskId: string): Promise<Task> {
    const res = await apiFetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`);
    if (!res.ok) throw new Error('Failed to fetch task');
    return res.json();
  },

  async updateTask(taskId: string, update: { status?: string; assigned_to?: string; priority?: string; source?: string }): Promise<Task> {
    const res = await apiFetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    });
    if (!res.ok) throw new Error('Failed to update task');
    return res.json();
  },

  async createTask(task: { title: string; description?: string; project?: string; priority?: string; source?: string; parent_id?: string; assigned_to?: string; resources?: string[] }): Promise<Task> {
    const res = await apiFetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    if (!res.ok) throw new Error('Failed to create task');
    return res.json();
  },

  async deleteTask(taskId: string): Promise<{ deleted: number; task_id: string }> {
    const res = await apiFetch(`${API_BASE}/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete task');
    return res.json();
  },

  async getTaskStats(): Promise<TaskStatsResponse> {
    const res = await apiFetch(`${API_BASE}/api/tasks/stats`);
    if (!res.ok) throw new Error('Failed to fetch task stats');
    return res.json();
  },

  async getTaskDag(project?: string): Promise<TaskDagResponse> {
    const qs = project ? `?project=${encodeURIComponent(project)}` : '';
    const res = await apiFetch(`${API_BASE}/api/tasks/dag${qs}`);
    if (!res.ok) throw new Error('Failed to fetch task dag');
    return res.json();
  },

  async getBudget(): Promise<BudgetResponse> {
    const res = await apiFetch(`${API_BASE}/api/budget`);
    if (!res.ok) throw new Error('Failed to fetch budget');
    return res.json();
  },

  async getBudgetStatus(): Promise<{
    daily_spend_usd: number;
    budget_limit_usd: number;
    percentage_used: number;
    throttled: boolean;
  }> {
    const res = await apiFetch(`${API_BASE}/api/budget/status`);
    if (!res.ok) throw new Error('Failed to fetch budget status');
    return res.json();
  },

  async getBudgetDaily(): Promise<{
    days: Array<{
      date: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_creation_tokens: number;
      event_count: number;
      /** Real cost where opencode's own session database has that day's
       * data, else a token-based estimate — see BudgetAgentUsage.cost_usd. */
      cost_usd: number;
      '7_day_moving_avg': number;
      day_over_day_delta: number | null;
    }>;
  }> {
    const res = await apiFetch(`${API_BASE}/api/budget/daily`);
    if (!res.ok) throw new Error('Failed to fetch daily budget');
    return res.json();
  },

  async getQualityMetrics(): Promise<{
    agents: QualityAgentMetrics[];
    summary: {
      total_completions: number;
      total_failures: number;
      total_cost_usd: number;
      system_cost_per_completion_usd: number | null;
      most_cost_effective_agent: string | null;
      system_first_pass_rate: number | null;
    };
  }> {
    const res = await apiFetch(`${API_BASE}/api/metrics/quality`);
    if (!res.ok) throw new Error('Failed to fetch quality metrics');
    return res.json();
  },

  async getQualityDuration(): Promise<{
    agents: Record<string, {
      task_count: number;
      avg_seconds: number;
      min_seconds: number;
      max_seconds: number;
    }>;
    overall_avg: number | null;
  }> {
    const res = await apiFetch(`${API_BASE}/api/metrics/quality/duration`);
    if (!res.ok) throw new Error('Failed to fetch quality duration');
    return res.json();
  },

  async getHealth(): Promise<HealthResponse> {
    const res = await apiFetch(`${API_BASE}/api/webhooks/health`);
    // Don't throw on 503 — degraded is a valid response
    return res.json();
  },

  // Secrets API — write-only from the frontend. Values are NEVER retrieved.
  async listSecrets(passphrase: string): Promise<{ secrets: string[]; count: number }> {
    const res = await apiFetch(`${API_BASE}/api/secrets/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Invalid passphrase');
    return res.json();
  },

  async setSecret(name: string, value: string, passphrase: string): Promise<{ ok: boolean; name: string }> {
    const res = await apiFetch(`${API_BASE}/api/secrets/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value, passphrase }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed to set secret');
    return res.json();
  },

  async deleteSecret(name: string, passphrase: string): Promise<{ ok: boolean; name: string }> {
    const res = await apiFetch(`${API_BASE}/api/secrets/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, passphrase }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed to delete secret');
    return res.json();
  },

  // ── System metrics (scorecard / reliability / heartbeat / prefs) ─────────

  async getScorecard(): Promise<ScorecardResponse> {
    const res = await apiFetch(`${API_BASE}/api/webhooks/scorecard`);
    if (!res.ok) throw new Error('Failed to fetch scorecard');
    return res.json();
  },

  async getAgentReliability(): Promise<{ agents: AgentReliability[] }> {
    const res = await apiFetch(`${API_BASE}/api/agents/reliability`);
    if (!res.ok) throw new Error('Failed to fetch agent reliability');
    return res.json();
  },

  async getFailureStats(): Promise<FailureStats> {
    const res = await apiFetch(`${API_BASE}/api/agents/failures`);
    if (!res.ok) throw new Error('Failed to fetch failure stats');
    return res.json();
  },

  async getHeartbeat(): Promise<HeartbeatEntry> {
    const res = await apiFetch(`${API_BASE}/api/heartbeat`);
    if (!res.ok) throw new Error('Failed to fetch heartbeat');
    return res.json();
  },

  async getHeartbeatHistory(limit = 50): Promise<{ heartbeats: HeartbeatEntry[]; total: number }> {
    const res = await apiFetch(`${API_BASE}/api/heartbeat/history?limit=${limit}`);
    if (!res.ok) throw new Error('Failed to fetch heartbeat history');
    return res.json();
  },

  async getPrefs(): Promise<Prefs> {
    const res = await apiFetch(`${API_BASE}/api/prefs`);
    if (!res.ok) throw new Error('Failed to fetch prefs');
    return res.json();
  },

  async updatePrefs(patch: Partial<Prefs>): Promise<Prefs> {
    const res = await apiFetch(`${API_BASE}/api/prefs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed to update prefs');
    return res.json();
  },

  async getGitStatus(): Promise<GitStatusResponse> {
    const res = await apiFetch(`${API_BASE}/api/webhooks/git-status`);
    if (!res.ok) throw new Error('Failed to fetch git status');
    return res.json();
  },

  async getCommitDiff(sha: string): Promise<CommitDiffResponse> {
    const res = await apiFetch(`${API_BASE}/api/webhooks/commit-diff?sha=${encodeURIComponent(sha)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Failed to fetch diff');
    return res.json();
  },
};

export interface GitChangedFile {
  path: string;
  status: string;
}

export interface GitCommit {
  sha: string;
  author: string;
  date: string;
  message: string;
}

export interface GitStatusResponse {
  branch: string;
  sha: string;
  ahead: number;
  behind: number;
  has_upstream: boolean;
  uncommitted_count: number;
  changed_files: GitChangedFile[];
  recent_commits: GitCommit[];
}

export interface CommitDiffFile {
  path: string;
  status: string;
  binary: boolean;
  old_content: string;
  new_content: string;
}

export interface CommitDiffResponse {
  sha: string;
  title: string;
  files: CommitDiffFile[];
  truncated: boolean;
}

export interface ScorecardResponse {
  uptime_seconds: number;
  tasks_completed_today: number;
  budget_usage_pct: number;
  agents_active: number;
  agents_sleeping: number;
  git_branch: string;
  git_sha: string;
}

export interface Prefs {
  heartbeat_warn_threshold: number;
  heartbeat_nudge_interval: number;
  heartbeat_max_nudges: number;
  heartbeat_observe_timeout: number;
  /** P5.2 settings panel — the one setting synced server-side (see
   *  lib/density.ts for why the rest stay in localStorage). */
  ui_density: 'comfortable' | 'compact';
}

export interface ReliabilityDayBucket {
  date: string; // "YYYY-MM-DD"
  verified: number;
  failed: number;
  /** null (not 0) when the agent had no activity that day — a quiet day
   *  is not the same thing as a 0% success rate day. */
  success_rate: number | null;
}

export interface AgentReliability {
  agent_id: string;
  verified: number;
  failed: number;
  success_rate: number;
  /** Last 14 days, oldest first, fixed contiguous window (no gaps). */
  history: ReliabilityDayBucket[];
}

export interface FailureLogEntry {
  id: number;
  timestamp: string;
  agent_id: string;
  failure_type: string;
  description: string;
  commit_sha: string | null;
  resolved: boolean;
  root_cause: string | null;
}

export interface FailureStats {
  total: number;
  by_type: Record<string, number>;
  by_agent: Record<string, { total: number; by_type: Record<string, number> }>;
  recent: FailureLogEntry[];
}

export interface QualityAgentMetrics {
  agent_id: string;
  completions: number;
  failures: number;
  total_cost_usd: number;
  completions_per_dollar: number | null;
  cost_per_completion_usd: number | null;
  success_rate: number;
  first_pass_successes: number;
  first_pass_rate: number | null;
}

export interface HeartbeatEntry {
  timestamp: number;
  sections: Record<string, string>;
  highest_priority: string | null;
  all_clear: boolean;
  received_at: string;
  supervisor_idle_seconds?: number | null;
  supervisor_state?: string | null;
}
