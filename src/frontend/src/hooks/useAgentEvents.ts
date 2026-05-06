import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useActivityStore } from '../stores/activityStore';
import type { Activity } from '../types/activity';

/**
 * Hook to load historical agent events on app start
 * and populate the activity store.
 */
export function useAgentEvents() {
  const { addActivities } = useActivityStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ['agent-events'],
    queryFn: () => api.getAgentEvents(undefined, 100),
    staleTime: 60000,
  });

  // Populate activity store with historical events on load
  useEffect(() => {
    if (data?.events && data.events.length > 0) {
      const activities: Activity[] = data.events.map((event) => ({
        id: event.id,
        timestamp: event.timestamp,
        type: event.event_type === 'Stop' ? 'status_change' : 'tool_call',
        agent_id: event.agent_id || event.session_id,
        data: {
          tool_name: event.tool_name,
          tool_input: event.tool_input,
          tool_output: event.tool_output,
        },
      }));
      addActivities(activities);
    }
  }, [data, addActivities]);

  return { events: data?.events || [], isLoading, error };
}
