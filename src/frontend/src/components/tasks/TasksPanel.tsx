import { useState, useMemo, useCallback, useEffect, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ListTodo, Loader2, List, Kanban, GitFork } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { FilterBar } from './FilterBar';
import { StatsSummary } from './StatsSummary';
import { cn } from '@/lib/utils';

// @dnd-kit and @xyflow/react are only needed for the board/graph views —
// lazy-loaded so the default list view (and every other route) doesn't pay
// for them. Without this the main chunk grew ~450KB (950KB total) just
// from TasksPanel's static imports of both libraries.
const TaskBoard = lazy(() => import('./TaskBoard').then((m) => ({ default: m.TaskBoard })));
const TaskDAG = lazy(() => import('./TaskDAG').then((m) => ({ default: m.TaskDAG })));

function ViewLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      loading view…
    </div>
  );
}
import {
  collectAssignees,
  countByStatus,
  filterByRegisteredProjects,
  filterTasks,
  flattenTasks,
  sortTasks,
  toggleInSet,
  type SortOption,
} from './task-utils';
import type { TaskStatus, TaskPriority } from '@/types/task';

/**
 * Task list shell: owns filter/sort/search state and the data pipeline;
 * rendering is delegated to StatsSummary / FilterBar / TaskCard (P2.8 split
 * of the former 741-line monolith).
 */
type ViewMode = 'list' | 'board' | 'graph';

export function TasksPanel() {
  const [view, setView] = useState<ViewMode>('list');
  const [statusFilters, setStatusFilters] = useState<Set<TaskStatus>>(new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<TaskPriority>>(new Set());
  const [assigneeFilters, setAssigneeFilters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortOption>('priority-time');
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link support (P5.1): the global command palette navigates here
  // with ?q=<task title> so landing on /tasks actually shows the task you
  // searched for, instead of an inert route change. Consumed once (param
  // stripped from the URL) rather than kept in sync both ways — simple
  // "arrive here filtered" behavior, not a full URL-as-state pattern.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setSearch(q);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('q');
        return next;
      }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data, isLoading, error, isFetching } = useTasks();
  const { data: projectsData } = useProjects();

  const registeredProjectIds = useMemo(() => {
    if (!projectsData?.projects) return new Set<string>();
    return new Set(projectsData.projects.map((p) => p.id));
  }, [projectsData]);

  const tasks = useMemo(() => {
    const raw = data?.tasks || [];
    if (registeredProjectIds.size === 0) return raw;
    return filterByRegisteredProjects(raw, registeredProjectIds);
  }, [data, registeredProjectIds]);

  const allAssignees = useMemo(() => collectAssignees(tasks), [tasks]);
  const allCounts = useMemo(() => countByStatus(tasks), [tasks]);
  const totalFlat = useMemo(() => flattenTasks(tasks).length, [tasks]);

  const filteredTasks = useMemo(() => {
    const filtered = filterTasks(tasks, statusFilters, priorityFilters, assigneeFilters, search);
    return sortTasks(filtered, sort);
  }, [tasks, statusFilters, priorityFilters, assigneeFilters, search, sort]);

  const handleStatusToggle = useCallback((s: TaskStatus) => {
    setStatusFilters((prev) => toggleInSet(prev, s));
  }, []);

  const handlePriorityToggle = useCallback((p: TaskPriority) => {
    setPriorityFilters((prev) => toggleInSet(prev, p));
  }, []);

  const handleAssigneeToggle = useCallback((a: string) => {
    setAssigneeFilters((prev) => toggleInSet(prev, a));
  }, []);

  const handleClearAll = useCallback(() => {
    setStatusFilters(new Set());
    setPriorityFilters(new Set());
    setAssigneeFilters(new Set());
    setSearch('');
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" />
        <span className="text-xs text-muted-foreground">Loading tasks...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs text-muted-foreground">No tasks yet</span>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          <ListTodo className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">
          No tasks yet. Tasks will appear as agents create them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats summary + view toggle */}
      <div className="flex items-center justify-between pr-3 border-b border-border/30">
        <StatsSummary counts={allCounts} total={totalFlat} />
        <div className="flex items-center gap-2">
          {isFetching && !isLoading && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0 motion-reduce:animate-none" />
          )}
          <div className="flex items-center gap-0.5 rounded border border-border/60 p-0.5" role="tablist" aria-label="task view">
            {([
              { mode: 'list', icon: List, label: 'list' },
              { mode: 'board', icon: Kanban, label: 'board' },
              { mode: 'graph', icon: GitFork, label: 'graph' },
            ] as const).map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                role="tab"
                aria-selected={view === mode}
                onClick={() => setView(mode)}
                title={label}
                className={cn(
                  'flex h-5 w-6 items-center justify-center rounded-sm transition-colors',
                  view === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-3 w-3" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter bar (list + board views — graph has its own project scope, no per-task filters) */}
      {view !== 'graph' && (
        <FilterBar
          statusFilters={statusFilters}
          onStatusToggle={handleStatusToggle}
          priorityFilters={priorityFilters}
          onPriorityToggle={handlePriorityToggle}
          assigneeFilters={assigneeFilters}
          onAssigneeToggle={handleAssigneeToggle}
          allAssignees={allAssignees}
          sort={sort}
          onSortChange={setSort}
          search={search}
          onSearchChange={setSearch}
          onClearAll={handleClearAll}
        />
      )}

      {/* Body */}
      {view === 'board' ? (
        <Suspense fallback={<ViewLoading />}>
          <TaskBoard tasks={filteredTasks} />
        </Suspense>
      ) : view === 'graph' ? (
        <Suspense fallback={<ViewLoading />}>
          <TaskDAG />
        </Suspense>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2.5">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-10">
                <p className="text-xs text-muted-foreground">No tasks match your filters.</p>
                <Button variant="ghost" size="sm" className="text-xs mt-3 h-7" onClick={handleClearAll}>
                  Clear filters
                </Button>
              </div>
            ) : (
              filteredTasks.map((task) => <TaskCard key={task.id} task={task} />)
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
