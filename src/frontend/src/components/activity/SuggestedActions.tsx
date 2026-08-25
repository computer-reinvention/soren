import { useState, useMemo } from 'react';
import { useAgentStore } from '@/stores/agentStore';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { useTasks } from '@/hooks/useTasks';
import { useAgentEventStore } from '@/stores/agentEventStore';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  AlertTriangle,
  ChevronDown,
  X,
  HeartPulse,
  Clock,
  ListTodo,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Suggestion {
  id: string;
  icon: React.ReactNode;
  message: string;
  severity: 'warning' | 'info';
}

export function SuggestedActions() {
  const [isOpen, setIsOpen] = useState(true);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { agents } = useAgentStore();
  const { data: healthData } = useHealthCheck();
  const { data: tasksData } = useTasks();
  const { latestEventBySession, isAgentActive } = useAgentEventStore();

  const suggestions = useMemo(() => {
    const items: Suggestion[] = [];

    // 1. Health check degraded
    if (healthData?.status === 'degraded') {
      items.push({
        id: 'health-degraded',
        icon: <HeartPulse className="h-3.5 w-3.5 text-amber-500" />,
        message: 'System health degraded. Check server logs.',
        severity: 'warning',
      });
    }

    // 2. Stale workers (>30min no activity, not IDLE/COMPLETE)
    for (const agent of agents) {
      if (agent.type === 'supervisor') continue;
      if (agent.status === 'IDLE' || agent.status === 'COMPLETE' || agent.status === 'SLEEPING') continue;

      const minutesSinceActivity = agent.last_activity
        ? (Date.now() - new Date(agent.last_activity).getTime()) / 60_000
        : null;

      // Check if actually working via events
      const isWorking = Object.entries(latestEventBySession).some(
        ([sessionId, event]) => {
          const eventAgentId = (event.agent_id || '').toLowerCase();
          const matchesAgent =
            eventAgentId === agent.id.toLowerCase() ||
            eventAgentId === agent.name.toLowerCase() ||
            (agent.display_name &&
              eventAgentId === agent.display_name.toLowerCase());
          return matchesAgent && isAgentActive(sessionId);
        },
      );

      if (
        !isWorking &&
        minutesSinceActivity !== null &&
        minutesSinceActivity > 30
      ) {
        const mins = Math.floor(minutesSinceActivity);
        const displayName = agent.display_name || agent.name;
        items.push({
          id: `stale-${agent.id}`,
          icon: <Clock className="h-3.5 w-3.5 text-amber-500" />,
          message: `${displayName} appears stale (${mins}min idle). Consider checking on it.`,
          severity: 'warning',
        });
      }
    }

    // 3. Backlog has items but no active workers
    if (tasksData?.tasks) {
      const backlogCount = tasksData.tasks.filter(
        (t) => t.status === 'backlog' || t.status === 'pending',
      ).length;

      const activeWorkers = agents.filter(
        (a) =>
          a.type === 'worker' &&
          (a.status === 'IN_PROGRESS' || a.status === 'TESTING'),
      );

      if (backlogCount > 0 && activeWorkers.length === 0) {
        items.push({
          id: 'backlog-idle',
          icon: <ListTodo className="h-3.5 w-3.5 text-blue-400" />,
          message: `Backlog has ${backlogCount} item${backlogCount !== 1 ? 's' : ''}. Consider spawning workers.`,
          severity: 'info',
        });
      }
    }

    // Filter out dismissed
    return items.filter((item) => !dismissed.has(item.id));
  }, [agents, healthData, tasksData, latestEventBySession, isAgentActive, dismissed]);

  // Hidden when no suggestions
  if (suggestions.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 hover:bg-muted/50 transition-colors border-b border-border/50">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="font-medium">
            {suggestions.length} suggested action{suggestions.length !== 1 ? 's' : ''}
          </span>
          <ChevronDown
            className={cn(
              'h-3 w-3 ml-auto transition-transform',
              !isOpen && '-rotate-90',
            )}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-b border-border/50">
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className={cn(
                'flex items-start gap-2 px-3 py-2 text-[11px] leading-relaxed',
                suggestion.severity === 'warning'
                  ? 'bg-amber-500/5'
                  : 'bg-blue-500/5',
              )}
            >
              <span className="mt-0.5 shrink-0">{suggestion.icon}</span>
              <span className="flex-1 text-muted-foreground">
                {suggestion.message}
              </span>
              <button
                onClick={() =>
                  setDismissed((prev) => new Set([...prev, suggestion.id]))
                }
                className="mt-0.5 shrink-0 text-muted-foreground dark:text-muted-foreground/80 hover:text-muted-foreground transition-colors"
                title="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
