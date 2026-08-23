import { useState, useMemo, useCallback } from 'react';
import { useTasks } from '@/hooks/useTasks';
import { useProjects } from '@/hooks/useProjects';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ListTodo, Loader2 } from 'lucide-react';
import { TaskCard } from './TaskCard';
import { FilterBar } from './FilterBar';
import { StatsSummary } from './StatsSummary';
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
export function TasksPanel() {
  const [statusFilters, setStatusFilters] = useState<Set<TaskStatus>>(new Set());
  const [priorityFilters, setPriorityFilters] = useState<Set<TaskPriority>>(new Set());
  const [assigneeFilters, setAssigneeFilters] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortOption>('priority-time');
  const [search, setSearch] = useState('');

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
      {/* Stats summary */}
      <div className="flex items-center justify-between pr-3 border-b border-border/30">
        <StatsSummary counts={allCounts} total={totalFlat} />
        {isFetching && !isLoading && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0 motion-reduce:animate-none" />
        )}
      </div>

      {/* Filter bar */}
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

      {/* Task cards */}
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
    </div>
  );
}
