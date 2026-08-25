import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { layoutDag } from '@/lib/dag-layout';
import { STATUS_CONFIGS, PRIORITY_CONFIGS } from './task-utils';
import { cn } from '@/lib/utils';
import { GitFork, Loader2 } from 'lucide-react';
import type { TaskDagNode } from '@/types/task';

const STATUS_BORDER: Record<string, string> = {
  backlog: 'border-violet-500/50',
  pending: 'border-zinc-500/50',
  assigned: 'border-blue-500/50',
  'in-progress': 'border-amber-500/50',
  done: 'border-emerald-500/50',
  blocked: 'border-red-500/50',
};

function TaskNode({ data }: NodeProps) {
  const task = data.task as TaskDagNode;
  const statusConfig = STATUS_CONFIGS[task.status] ?? STATUS_CONFIGS.pending;
  const priorityConfig = task.priority ? PRIORITY_CONFIGS[task.priority] : null;

  return (
    <div
      className={cn(
        'w-[200px] rounded-md border-2 bg-card px-2.5 py-2 shadow-sm',
        STATUS_BORDER[task.status] ?? 'border-border'
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50" />
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50" />
      <div className="flex items-center gap-1 mb-1">
        <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusConfig.dot)} />
        <span className="font-mono text-[9px] uppercase text-muted-foreground truncate">
          {statusConfig.label}
        </span>
        {priorityConfig && (
          <span className="ml-auto font-mono text-[9px] text-muted-foreground dark:text-muted-foreground/85 truncate">
            {priorityConfig.label}
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium leading-snug line-clamp-2" title={task.title}>
        {task.title}
      </p>
      {task.assigned_to && (
        <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground dark:text-muted-foreground/85">
          @{task.assigned_to}
        </p>
      )}
    </div>
  );
}

const nodeTypes = { taskNode: TaskNode };

/**
 * Task dependency graph (P3.6): nodes = tasks, edges = "must complete
 * before" dependencies. Layout is a pure topological layering (see
 * lib/dag-layout.ts) — no dagre/elkjs needed at this graph size.
 */
export function TaskDAG({ project }: { project?: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['task-dag', project],
    queryFn: () => api.getTaskDag(project),
    staleTime: 30_000,
  });

  const { nodes, edges } = useMemo(
    () => (data ? layoutDag(data.nodes, data.edges) : { nodes: [], edges: [] }),
    [data]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        loading graph…
      </div>
    );
  }

  if (error || !data || data.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <GitFork className="h-6 w-6 opacity-40" aria-hidden />
        {error ? 'failed to load task graph' : 'no tasks yet'}
      </div>
    );
  }

  return (
    <div className="h-full">
      {data.edges.length === 0 && (
        <div className="absolute z-10 m-2 rounded border border-border/60 bg-background/90 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          no dependencies recorded — showing {data.nodes.length} independent tasks
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        {data.nodes.length > 15 && <MiniMap pannable zoomable className="!bg-card" />}
      </ReactFlow>
    </div>
  );
}
