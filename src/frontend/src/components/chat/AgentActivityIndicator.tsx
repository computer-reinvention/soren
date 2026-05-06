import { useEffect, useState, useMemo } from 'react';
import { useAgentEventStore } from '@/stores/agentEventStore';
import { cn } from '@/lib/utils';
import { getToolSummary } from '@/lib/toolSummary';
import { Loader2, Check, ChevronUp, ChevronDown } from 'lucide-react';
import type { AgentEvent } from '@/types/agent_event';

interface AgentActivityIndicatorProps {
  agentId?: string;
  className?: string;
}

const MAX_VISIBLE_EVENTS = 5;

export function AgentActivityIndicator({
  agentId,
  className,
}: AgentActivityIndicatorProps) {
  const { eventsBySession, latestEventBySession, isAgentActive } = useAgentEventStore();
  const [isVisible, setIsVisible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Find active sessions that match the agent
  const activeSessions = useMemo(() =>
    Object.entries(latestEventBySession).filter(
      ([sessionId, event]) => {
        if (!agentId) return isAgentActive(sessionId);
        return event.agent_id === agentId && isAgentActive(sessionId);
      }
    ),
    [agentId, latestEventBySession, isAgentActive]
  );

  const hasActivity = activeSessions.length > 0;

  // Get recent PostToolUse events for display
  const recentEvents = useMemo(() => {
    if (!hasActivity) return [];
    const allEvents: AgentEvent[] = [];
    for (const [sessionId] of activeSessions) {
      const events = eventsBySession[sessionId] || [];
      allEvents.push(...events);
    }
    return allEvents
      .filter(e => e.event_type === 'PostToolUse' && e.tool_name)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, MAX_VISIBLE_EVENTS);
  }, [hasActivity, activeSessions, eventsBySession]);

  // Animate visibility with delay on hide to prevent flicker
  useEffect(() => {
    if (hasActivity) {
      setIsVisible(true);
    } else {
      const timeout = setTimeout(() => {
        setIsVisible(false);
        setIsExpanded(false);
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, [hasActivity]);

  if (!isVisible || recentEvents.length === 0) return null;

  const latestEvent = recentEvents[0];
  const olderEvents = recentEvents.slice(1);

  return (
    <div
      className={cn(
        'border-t bg-muted/30 transition-all duration-300',
        className
      )}
    >
      {/* Latest activity - always visible */}
      <button
        onClick={() => olderEvents.length > 0 && setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-1.5 text-sm transition-colors',
          olderEvents.length > 0 && 'hover:bg-muted/50 cursor-pointer',
          olderEvents.length === 0 && 'cursor-default'
        )}
      >
        {hasActivity ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
        ) : (
          <Check className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
        )}
        <span className="font-medium text-foreground/80 truncate text-xs">
          {getToolSummary(latestEvent.tool_name!, latestEvent.tool_input)}
        </span>
        {olderEvents.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground flex-shrink-0">
            +{olderEvents.length}
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </span>
        )}
      </button>

      {/* Expanded history of recent tool calls */}
      {isExpanded && olderEvents.length > 0 && (
        <div className="px-4 pb-1.5 space-y-0 animate-in slide-in-from-top-1 duration-150">
          {olderEvents.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-2 text-[11px] text-muted-foreground py-0.5"
            >
              <Check className="h-3 w-3 text-green-500/50 flex-shrink-0" />
              <span className="truncate">
                {getToolSummary(event.tool_name!, event.tool_input)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
