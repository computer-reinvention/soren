import type { Agent } from '@/types/agent';
import type { Project } from '@/types/project';

/**
 * Pure grouping logic for the sidebar: every agent lives under exactly one
 * project group, with the group's supervisor pinned first.
 *
 * Model (per user directive): PROJECT → [supervisor, ...agents]. No team
 * sub-nesting, no activity buckets — teams appear as row badges, activity as
 * sort order. One mental model, one code path.
 */

export const SYSTEM_PROJECT_ID = 'soren';

export interface ProjectGroupData {
  id: string;
  name: string;
  isSystem: boolean;
  supervisor: Agent | null;
  /** Sorted: needs-attention → working → idle → done → sleeping, then name. */
  agents: Agent[];
  attentionCount: number; // BLOCKED + FAILED
  activeCount: number; // IN_PROGRESS + TESTING
  sleepingCount: number;
}

const STATUS_RANK: Record<string, number> = {
  BLOCKED: 0,
  FAILED: 0,
  IN_PROGRESS: 1,
  TESTING: 1,
  PENDING: 2,
  IDLE: 2,
  COMPLETE: 3,
  SLEEPING: 4,
};

const rank = (a: Agent) => STATUS_RANK[a.status] ?? 2;

export function sortAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (a.display_name || a.name).localeCompare(b.display_name || b.name);
  });
}

function isSupervisor(agent: Agent): boolean {
  return agent.type === 'supervisor';
}

/** The main system supervisor beats project supervisors for the system group. */
function supervisorPriority(agent: Agent): number {
  return agent.name === 'supervisor' ? 0 : 1;
}

export function groupAgentsByProject(
  agents: Agent[],
  projects: Project[]
): ProjectGroupData[] {
  const byProject = new Map<string, Agent[]>();
  for (const agent of agents) {
    const pid = agent.project_id || SYSTEM_PROJECT_ID;
    const bucket = byProject.get(pid);
    if (bucket) bucket.push(agent);
    else byProject.set(pid, [agent]);
  }

  const registered = new Map<string, Project>(projects.map((p) => [p.id, p]));
  const systemProject = projects.find((p) => p.is_self);
  const systemId = systemProject?.id ?? SYSTEM_PROJECT_ID;

  // Registered projects (system first, then by name) + any orphan project ids
  // that agents reference but the registry doesn't know.
  const orderedIds: string[] = [
    systemId,
    ...projects
      .filter((p) => p.id !== systemId)
      .map((p) => p.id)
      .sort((a, b) =>
        (registered.get(a)?.name ?? a).localeCompare(registered.get(b)?.name ?? b)
      ),
    ...[...byProject.keys()].filter((id) => id !== systemId && !registered.has(id)).sort(),
  ];
  // The synthetic system bucket can differ from the registered self project id.
  if (systemId !== SYSTEM_PROJECT_ID && byProject.has(SYSTEM_PROJECT_ID)) {
    const synthetic = byProject.get(SYSTEM_PROJECT_ID)!;
    byProject.set(systemId, [...(byProject.get(systemId) ?? []), ...synthetic]);
    byProject.delete(SYSTEM_PROJECT_ID);
  }

  const seen = new Set<string>();
  const groups: ProjectGroupData[] = [];

  for (const id of orderedIds) {
    if (seen.has(id)) continue;
    seen.add(id);

    const members = byProject.get(id) ?? [];
    const isSystem = id === systemId;
    // Skip empty non-system projects only if they're unregistered orphans;
    // registered projects show (empty) so users see them at all.
    if (members.length === 0 && !isSystem && !registered.has(id)) continue;

    const supervisors = members.filter(isSupervisor).sort(
      (a, b) => supervisorPriority(a) - supervisorPriority(b)
    );
    const supervisor = supervisors[0] ?? null;
    const rest = sortAgents(members.filter((a) => a !== supervisor));

    groups.push({
      id,
      name: isSystem ? 'soren' : registered.get(id)?.name ?? id,
      isSystem,
      supervisor,
      agents: rest,
      attentionCount: members.filter((a) => a.status === 'BLOCKED' || a.status === 'FAILED').length,
      activeCount: members.filter((a) => a.status === 'IN_PROGRESS' || a.status === 'TESTING').length,
      sleepingCount: members.filter((a) => a.status === 'SLEEPING').length,
    });
  }

  return groups;
}

/** Case-insensitive filter: keeps groups whose name matches, or any agent matches. */
export function filterGroups(groups: ProjectGroupData[], query: string): ProjectGroupData[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;

  const matches = (a: Agent) =>
    a.name.toLowerCase().includes(q) ||
    (a.display_name?.toLowerCase().includes(q) ?? false) ||
    (a.role?.toLowerCase().includes(q) ?? false);

  return groups
    .map((g) => {
      if (g.name.toLowerCase().includes(q)) return g; // whole group matches
      const supervisor = g.supervisor && matches(g.supervisor) ? g.supervisor : null;
      const agents = g.agents.filter(matches);
      if (!supervisor && agents.length === 0) return null;
      return { ...g, supervisor, agents };
    })
    .filter((g): g is ProjectGroupData => g !== null);
}

export const STATUS_DOT: Record<string, string> = {
  BLOCKED: 'bg-red-500',
  FAILED: 'bg-red-500',
  IN_PROGRESS: 'bg-emerald-500',
  TESTING: 'bg-amber-500',
  PENDING: 'bg-blue-400',
  IDLE: 'bg-muted-foreground/50',
  COMPLETE: 'bg-muted-foreground/50',
  SLEEPING: 'bg-muted-foreground/25',
};

export function relativeActivity(iso: string | null): string {
  if (!iso) return '';
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 0 || Number.isNaN(delta)) return '';
  const m = Math.floor(delta / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
