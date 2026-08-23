import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ArrowUpDown, ChevronDown, Filter, Search, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ALL_PRIORITIES,
  ALL_STATUSES,
  PRIORITY_CONFIGS,
  SORT_LABELS,
  STATUS_CONFIGS,
  type SortOption,
} from './task-utils';
import type { TaskStatus, TaskPriority } from '@/types/task';

interface FilterBarProps {
  statusFilters: Set<TaskStatus>;
  onStatusToggle: (s: TaskStatus) => void;
  priorityFilters: Set<TaskPriority>;
  onPriorityToggle: (p: TaskPriority) => void;
  assigneeFilters: Set<string>;
  onAssigneeToggle: (a: string) => void;
  allAssignees: string[];
  sort: SortOption;
  onSortChange: (s: SortOption) => void;
  search: string;
  onSearchChange: (s: string) => void;
  onClearAll: () => void;
}

/** Fully controlled task filter/search/sort strip. */
export function FilterBar({
  statusFilters,
  onStatusToggle,
  priorityFilters,
  onPriorityToggle,
  assigneeFilters,
  onAssigneeToggle,
  allAssignees,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onClearAll,
}: FilterBarProps) {
  const hasFilters =
    statusFilters.size > 0 || priorityFilters.size > 0 || assigneeFilters.size > 0 || search.length > 0;

  const statusLabel =
    statusFilters.size === 0
      ? 'Status'
      : statusFilters.size === 1
        ? STATUS_CONFIGS[[...statusFilters][0]]?.label ?? 'Status'
        : `Status (${statusFilters.size})`;

  const priorityLabel =
    priorityFilters.size === 0
      ? 'Priority'
      : priorityFilters.size === 1
        ? PRIORITY_CONFIGS[[...priorityFilters][0]]?.label ?? 'Priority'
        : `Priority (${priorityFilters.size})`;

  const assigneeLabel =
    assigneeFilters.size === 0
      ? 'Assignee'
      : assigneeFilters.size === 1
        ? [...assigneeFilters][0]
        : `Assignee (${assigneeFilters.size})`;

  return (
    <div className="px-3 py-2 space-y-2 border-b border-border/50">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="h-7 pl-7 pr-6 text-xs bg-muted/50 border-none"
        />
        {search && (
          <button
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onSearchChange('')}
            aria-label="clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-3 w-3 text-muted-foreground shrink-0" />

        {/* Status filter (multi-select) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-5 text-[10px] px-1.5 gap-1',
                statusFilters.size > 0 && 'border-primary/50 bg-primary/5',
              )}
            >
              {statusLabel}
              <ChevronDown className="h-2.5 w-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-36">
            <DropdownMenuLabel className="text-[10px] py-1">Filter by status</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_STATUSES.map((s) => (
              <DropdownMenuCheckboxItem
                key={s}
                className="text-xs py-1"
                checked={statusFilters.has(s)}
                onCheckedChange={() => onStatusToggle(s)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', STATUS_CONFIGS[s].dot)} />
                  {STATUS_CONFIGS[s].label}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority filter (multi-select) */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                'h-5 text-[10px] px-1.5 gap-1',
                priorityFilters.size > 0 && 'border-primary/50 bg-primary/5',
              )}
            >
              {priorityLabel}
              <ChevronDown className="h-2.5 w-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-32">
            <DropdownMenuLabel className="text-[10px] py-1">Filter by priority</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_PRIORITIES.map((p) => (
              <DropdownMenuCheckboxItem
                key={p}
                className="text-xs py-1"
                checked={priorityFilters.has(p)}
                onCheckedChange={() => onPriorityToggle(p)}
                onSelect={(e) => e.preventDefault()}
              >
                {PRIORITY_CONFIGS[p].label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assignee filter (multi-select) */}
        {allAssignees.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  'h-5 text-[10px] px-1.5 gap-1',
                  assigneeFilters.size > 0 && 'border-primary/50 bg-primary/5',
                )}
              >
                <User className="h-2.5 w-2.5" />
                {assigneeLabel}
                <ChevronDown className="h-2.5 w-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40 max-h-48 overflow-y-auto">
              <DropdownMenuLabel className="text-[10px] py-1">Filter by assignee</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {allAssignees.map((a) => (
                <DropdownMenuCheckboxItem
                  key={a}
                  className="text-xs py-1"
                  checked={assigneeFilters.has(a)}
                  onCheckedChange={() => onAssigneeToggle(a)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {a}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-5 text-[10px] px-1.5 gap-1">
              <ArrowUpDown className="h-2.5 w-2.5" />
              {SORT_LABELS[sort]}
              <ChevronDown className="h-2.5 w-2.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel className="text-[10px] py-1">Sort tasks</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
              <DropdownMenuItem
                key={opt}
                className={cn('text-xs py-1', sort === opt && 'font-medium')}
                onClick={() => onSortChange(opt)}
              >
                {SORT_LABELS[opt]}
                {sort === opt && <span className="ml-auto text-[10px] text-muted-foreground">*</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Clear filters */}
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
            onClick={onClearAll}
          >
            <X className="h-2.5 w-2.5 mr-0.5" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
