import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgentEventStore } from '../stores/agentEventStore';
import { api } from '../lib/api';
import type { AgentEvent } from '../types/agent_event';

interface UseAgentOutputOptions {
  // Session ID to filter events (optional - if not provided, uses agent ID)
  sessionId?: string;
  // Agent ID (used if sessionId not provided)
  agentId?: string;
}

export function useAgentOutput({
  sessionId,
  agentId,
}: UseAgentOutputOptions = {}) {
  const effectiveId = sessionId || agentId;

  // Get events from store (populated by WebSocket)
  const eventsBySession = useAgentEventStore((state) => state.eventsBySession);

  // Also fetch from API on mount (to get historical events)
  const { data: apiEvents, isLoading } = useQuery({
    queryKey: ['agent-events', effectiveId],
    queryFn: () => (effectiveId ? api.getAgentEvents(effectiveId) : null),
    enabled: !!effectiveId,
  });

  // Merge store events with API events, deduplicate by id
  const events = useMemo(() => {
    if (!effectiveId) return [];

    const storeEvents = eventsBySession[effectiveId] || [];
    const fetchedEvents = apiEvents?.events || [];

    // Merge and deduplicate
    const eventMap = new Map<string, AgentEvent>();

    // API events first (older)
    for (const event of fetchedEvents) {
      eventMap.set(event.id, event);
    }

    // Store events override (newer, from WebSocket)
    for (const event of storeEvents) {
      eventMap.set(event.id, event);
    }

    // Sort by timestamp descending (newest first)
    return Array.from(eventMap.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [effectiveId, eventsBySession, apiEvents]);

  return {
    events,
    isLoading,
    hasEvents: events.length > 0,
  };
}
