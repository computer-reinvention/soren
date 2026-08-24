import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Announcements,
  type ScreenReaderInstructions,
} from '@dnd-kit/core';
import { useUpdateTask } from '@/hooks/useTasks';
import { ScrollArea } from '@/components/ui/scroll-area';
import { User, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_STATUSES, STATUS_CONFIGS, PRIORITY_CONFIGS, flattenTasks } from './task-utils';
import type { Task, TaskStatus } from '@/types/task';

/**
 * dnd-kit's useDraggable unconditionally advertises keyboard drag support
 * in its ARIA description ("press space bar to pick up... arrow keys to
 * move"). That's a false affordance without a matching KeyboardSensor —
 * caught during accessibility review of this feature. This coordinateGetter
 * makes the promise real: Left/Right jump the virtual pointer to the
 * previous/next column's center (so collision detection lands the drop in
 * that column); Up/Down do the default small nudge for scroll behavior.
 */
function createColumnCoordinateGetter(
  statusOrder: string[],
  getTaskStatus: (id: string) => string | undefined
): KeyboardCoordinateGetter {
  return (event, { active, currentCoordinates, context }) => {
    const { droppableRects, over } = context;
    const key = event.code;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'ArrowDown' && key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();

    if (key === 'ArrowDown') return { ...currentCoordinates, y: currentCoordinates.y + 50 };
    if (key === 'ArrowUp') return { ...currentCoordinates, y: currentCoordinates.y - 50 };

    const currentStatus = (over?.id as string) ?? getTaskStatus(active as string) ?? statusOrder[0];
    const currentIndex = Math.max(0, statusOrder.indexOf(currentStatus));
    const targetIndex =
      key === 'ArrowRight'
        ? Math.min(currentIndex + 1, statusOrder.length - 1)
        : Math.max(currentIndex - 1, 0);
    const targetRect = droppableRects.get(statusOrder[targetIndex]);
    if (!targetRect) return;

    return { x: targetRect.left + targetRect.width / 2, y: targetRect.top + 60 };
  };
}

/**
 * Kanban board (P3.5): drag a card to a different column to change its
 * status (PATCH via the existing useUpdateTask mutation — no new backend
 * work needed). Top-level tasks only; subtasks surface as a count badge
 * on the parent card, consistent with the list view's card treatment.
 */
export function TaskBoard({ tasks }: { tasks: Task[] }) {
  const updateTask = useUpdateTask();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const getTaskStatus = useMemo(() => {
    const map = new Map(tasks.map((t) => [t.id, t.status]));
    return (id: string) => map.get(id);
  }, [tasks]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: createColumnCoordinateGetter(ALL_STATUSES, getTaskStatus),
    })
  );

  // dnd-kit's default screen-reader announcements identify tasks by their
  // raw id ("Draggable item 57863db8-... was dropped") — meaningless to a
  // screen reader user. Use task titles and column labels instead.
  const announcements: Announcements = useMemo(() => {
    const getTitle = (id: string | number) => tasks.find((t) => t.id === id)?.title ?? 'task';
    const getColumnLabel = (id: string | number | undefined | null) =>
      id ? (STATUS_CONFIGS[id as string]?.label ?? String(id)) : null;
    return {
      onDragStart: ({ active }) => `Picked up "${getTitle(active.id)}".`,
      onDragOver: ({ active, over }) => {
        const label = getColumnLabel(over?.id);
        return label ? `"${getTitle(active.id)}" is over the ${label} column.` : undefined;
      },
      onDragEnd: ({ active, over }) => {
        const label = getColumnLabel(over?.id);
        return label
          ? `"${getTitle(active.id)}" was moved to ${label}.`
          : `"${getTitle(active.id)}" was dropped.`;
      },
      onDragCancel: ({ active }) => `Moving "${getTitle(active.id)}" was cancelled.`,
    };
  }, [tasks]);

  const screenReaderInstructions: ScreenReaderInstructions = useMemo(
    () => ({
      draggable:
        'To pick up a task, press space. Use the left and right arrow keys to move it between columns. Press space again to drop, or escape to cancel.',
    }),
    []
  );

  const byStatus = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const s of ALL_STATUSES) map.set(s, []);
    for (const t of tasks) {
      const bucket = map.get(t.status) ?? map.set(t.status, []).get(t.status)!;
      bucket.push(t);
    }
    return map;
  }, [tasks]);

  const handleDragStart = (e: DragStartEvent) => {
    const task = tasks.find((t) => t.id === e.active.id);
    setActiveTask(task ?? null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const taskId = e.active.id as string;
    const newStatus = e.over?.id as TaskStatus | undefined;
    if (!newStatus) return;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    updateTask.mutate({ taskId, update: { status: newStatus } });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      <div className="flex h-full gap-2 overflow-x-auto p-3">
        {ALL_STATUSES.map((status) => (
          <Column key={status} status={status} tasks={byStatus.get(status) ?? []} />
        ))}
      </div>
      <DragOverlay>
        {activeTask && <TaskCardMini task={activeTask} dragging />}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks }: { status: string; tasks: Task[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const config = STATUS_CONFIGS[status] ?? STATUS_CONFIGS.pending;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-md border border-border/50 bg-muted/10 transition-colors',
        isOver && 'border-primary/50 bg-primary/5'
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border/50 px-2.5 py-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', config.dot)} />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wide">
          {config.label}
        </span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{tasks.length}</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-1.5 p-1.5">
          {tasks.map((t) => (
            <DraggableCard key={t.id} task={t} />
          ))}
          {tasks.length === 0 && (
            <p className="px-2 py-4 text-center font-mono text-[10px] text-muted-foreground/50">
              empty
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function DraggableCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn('touch-none', isDragging && 'opacity-30')}
    >
      <TaskCardMini task={task} />
    </div>
  );
}

function TaskCardMini({ task, dragging }: { task: Task; dragging?: boolean }) {
  const priorityConfig = task.priority ? PRIORITY_CONFIGS[task.priority] : null;
  const childCount = task.children?.length ?? 0;

  return (
    <div
      className={cn(
        'cursor-grab rounded border border-border bg-card p-2 active:cursor-grabbing',
        dragging && 'rotate-2 shadow-lg ring-1 ring-primary/50'
      )}
    >
      <div className="flex items-center gap-1 mb-1">
        {priorityConfig && (
          <span className={cn('rounded-sm border px-1 font-mono text-[9px]', priorityConfig.color)}>
            {priorityConfig.label}
          </span>
        )}
        {childCount > 0 && (
          <span className="ml-auto font-mono text-[9px] text-muted-foreground/60">
            {flattenTasks(task.children!).length} sub
          </span>
        )}
      </div>
      <p className="text-[12px] font-medium leading-snug line-clamp-3">{task.title}</p>
      {task.assigned_to && (
        <p className="mt-1 flex items-center gap-0.5 font-mono text-[9px] text-muted-foreground">
          <User className="h-2.5 w-2.5" aria-hidden />
          {task.assigned_to}
        </p>
      )}
    </div>
  );
}

export function TaskBoardLoading() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
      loading board…
    </div>
  );
}
