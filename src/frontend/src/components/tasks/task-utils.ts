import type { Task, TaskStatus, TaskPriority } from '@/types/task';

/** Task display constants + pure tree helpers (extracted from TasksPanel, P2.8). */

// P5.8 found several of these text colors fell short of 4.5:1 against
// their own tinted /15 badge background in dark mode; P6.7 finished the
// job by individually tuning the light-mode (unprefixed) shade per color
// too — no single shade works uniformly across this whole palette against
// a near-white background, so each pair below was picked by actually
// computing its contrast ratio rather than guessing (see index.css's
// P6.7 comments for the same exercise applied to the CSS custom
// properties). Every pair here clears 4.5:1 in both themes.
export const STATUS_CONFIGS: Record<string, { label: string; color: string; dot: string }> = {
  backlog: { label: 'Backlog', color: 'bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30', dot: 'bg-violet-400' },
  pending: { label: 'Pending', color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30', dot: 'bg-zinc-400' },
  assigned: { label: 'Assigned', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30', dot: 'bg-blue-400' },
  'in-progress': { label: 'In Progress', color: 'bg-amber-500/15 text-amber-800 dark:text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  done: { label: 'Done', color: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' },
  blocked: { label: 'Blocked', color: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30', dot: 'bg-red-400' },
};

export const PRIORITY_CONFIGS: Record<string, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'bg-red-500/20 text-red-700 dark:text-red-400 border-red-500/30' },
  high: { label: 'High', color: 'bg-orange-500/20 text-orange-800 dark:text-orange-400 border-orange-500/30' },
  medium: { label: 'Medium', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30' },
  low: { label: 'Low', color: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20' },
};

export const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const ALL_STATUSES: TaskStatus[] = ['backlog', 'pending', 'assigned', 'in-progress', 'done', 'blocked'];
export const ALL_PRIORITIES: TaskPriority[] = ['critical', 'high', 'medium', 'low'];

export type SortOption = 'priority-desc' | 'priority-asc' | 'time-desc' | 'time-asc' | 'priority-time';

export const SORT_LABELS: Record<SortOption, string> = {
  'priority-desc': 'Priority (high first)',
  'priority-asc': 'Priority (low first)',
  'time-desc': 'Newest first',
  'time-asc': 'Oldest first',
  'priority-time': 'Priority, then newest',
};

export function relativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return `${Math.floor(diffDay / 7)}w ago`;
}

export function flattenTasks(tasks: Task[]): Task[] {
  const result: Task[] = [];
  for (const task of tasks) {
    result.push(task);
    if (task.children?.length) {
      result.push(...flattenTasks(task.children));
    }
  }
  return result;
}

export function countByStatus(tasks: Task[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of flattenTasks(tasks)) {
    counts[t.status] = (counts[t.status] || 0) + 1;
  }
  return counts;
}

export function collectAssignees(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const t of flattenTasks(tasks)) {
    if (t.assigned_to) set.add(t.assigned_to);
  }
  return Array.from(set).sort();
}

export function matchesSearch(task: Task, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    task.title.toLowerCase().includes(q) ||
    task.description?.toLowerCase().includes(q) ||
    task.assigned_to?.toLowerCase().includes(q) ||
    task.project?.toLowerCase().includes(q)
  );
}

/** Recursive filter; keeps a parent when any descendant matches. */
export function filterTasks(
  tasks: Task[],
  statuses: Set<TaskStatus>,
  priorities: Set<TaskPriority>,
  assignees: Set<string>,
  search: string,
): Task[] {
  return tasks
    .map((task) => {
      const filteredChildren = task.children?.length
        ? filterTasks(task.children, statuses, priorities, assignees, search)
        : [];

      const selfMatches =
        (statuses.size === 0 || statuses.has(task.status as TaskStatus)) &&
        (priorities.size === 0 || priorities.has((task.priority || 'medium') as TaskPriority)) &&
        (assignees.size === 0 || assignees.has(task.assigned_to || '')) &&
        matchesSearch(task, search);

      if (selfMatches || filteredChildren.length > 0) {
        return { ...task, children: filteredChildren };
      }
      return null;
    })
    .filter(Boolean) as Task[];
}

export function sortTasks(tasks: Task[], sort: SortOption): Task[] {
  const sorted = [...tasks].sort((a, b) => {
    switch (sort) {
      case 'priority-desc': {
        const pa = PRIORITY_ORDER[a.priority || 'medium'] ?? 2;
        const pb = PRIORITY_ORDER[b.priority || 'medium'] ?? 2;
        return pa - pb;
      }
      case 'priority-asc': {
        const pa = PRIORITY_ORDER[a.priority || 'medium'] ?? 2;
        const pb = PRIORITY_ORDER[b.priority || 'medium'] ?? 2;
        return pb - pa;
      }
      case 'time-desc':
        return (b.created_at || '').localeCompare(a.created_at || '');
      case 'time-asc':
        return (a.created_at || '').localeCompare(b.created_at || '');
      case 'priority-time': {
        const pa = PRIORITY_ORDER[a.priority || 'medium'] ?? 2;
        const pb = PRIORITY_ORDER[b.priority || 'medium'] ?? 2;
        if (pa !== pb) return pa - pb;
        return (b.created_at || '').localeCompare(a.created_at || '');
      }
    }
  });
  return sorted.map((t) =>
    t.children?.length ? { ...t, children: sortTasks(t.children, sort) } : t,
  );
}

export function filterByRegisteredProjects(tasks: Task[], registeredProjectIds: Set<string>): Task[] {
  return tasks.filter((t) => !t.project || registeredProjectIds.has(t.project));
}

export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
