import { useState } from 'react';
import { useUpdateTask } from '@/hooks/useTasks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ChevronRight, Clock, ExternalLink, FolderOpen, MoreHorizontal, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_STATUSES, PRIORITY_CONFIGS, STATUS_CONFIGS, relativeTime } from './task-utils';
import type { Task } from '@/types/task';

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIGS[status] || STATUS_CONFIGS.pending;
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4 font-medium gap-1', config.color)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
      {config.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority) return null;
  const config = PRIORITY_CONFIGS[priority] || PRIORITY_CONFIGS.medium;
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4 font-medium', config.color)}>
      {config.label}
    </Badge>
  );
}

function StatusDropdown({ task }: { task: Task }) {
  const updateTask = useUpdateTask();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel className="text-[10px] py-1">Set Status</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ALL_STATUSES.map((s) => {
          const config = STATUS_CONFIGS[s];
          return (
            <DropdownMenuItem
              key={s}
              className="text-xs gap-2 py-1"
              disabled={task.status === s}
              onClick={(e) => {
                e.stopPropagation();
                updateTask.mutate({ taskId: task.id, update: { status: s } });
              }}
            >
              <span className={cn('w-2 h-2 rounded-full', config.dot)} />
              {config.label}
              {task.status === s && <span className="ml-auto text-[10px] text-muted-foreground">(current)</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TaskCard({ task, depth = 0 }: { task: Task; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [childrenOpen, setChildrenOpen] = useState(true);
  const hasChildren = (task.children?.length ?? 0) > 0;
  const childCount = task.children?.length ?? 0;

  return (
    <div className={cn(depth > 0 && 'ml-4 border-l border-border/50 pl-3')}>
      <div
        className={cn(
          'group rounded-lg border bg-card p-3 compact:p-1.5 cursor-pointer transition-colors',
          'hover:bg-accent/50 hover:border-border',
          expanded && 'bg-accent/30 border-border',
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Top row: status + title + actions */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
            </div>
            <h4 className="text-[13px] font-medium leading-snug truncate">{task.title}</h4>
          </div>
          <StatusDropdown task={task} />
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {task.assigned_to && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <User className="h-2.5 w-2.5" />
              {task.assigned_to}
            </span>
          )}
          {task.project && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/70">
              <FolderOpen className="h-2.5 w-2.5" />
              {task.project}
            </span>
          )}
          {task.created_at && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground/50">
              <Clock className="h-2.5 w-2.5" />
              {relativeTime(task.created_at)}
            </span>
          )}
          {childCount > 0 && (
            <span className="text-[10px] text-muted-foreground/50">
              {childCount} subtask{childCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-2.5 pt-2.5 border-t border-border/50 space-y-2">
            {task.description && (
              <p className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {task.description}
              </p>
            )}
            {task.resources?.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                {task.resources.map((url, i) => (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-blue-500 hover:underline inline-flex items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Resource {i + 1}
                  </a>
                ))}
              </div>
            )}
            {task.source && (
              <span className="text-[10px] text-muted-foreground/50">Source: {task.source}</span>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && (
        <Collapsible open={childrenOpen} onOpenChange={setChildrenOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 mt-1 mb-0.5 px-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              <ChevronRight className={cn('h-3 w-3 transition-transform', childrenOpen && 'rotate-90')} />
              {childCount} subtask{childCount !== 1 ? 's' : ''}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 mt-1.5">
              {task.children!.map((child) => (
                <TaskCard key={child.id} task={child} depth={depth + 1} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
