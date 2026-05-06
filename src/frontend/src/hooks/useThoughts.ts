import { useEffect, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useThoughtStore } from '../stores/thoughtStore';
import { useProjectStore } from '../stores/projectStore';
import { useProjectAgents } from './useProjects';
import type { Thought } from '../stores/thoughtStore';

/**
 * Hook to load historical thoughts on app start
 * and populate the thought store so they persist across page refreshes.
 *
 * When a project is selected, fetches thoughts per-agent for that project
 * instead of the global limit=200 (which can miss older project agent data).
 */
export function useThoughts() {
  const { addThoughts } = useThoughtStore();
  const { selectedProjectId } = useProjectStore();
  const { data: projectAgentsData } = useProjectAgents(selectedProjectId);

  const projectAgentNames = useMemo(() => {
    if (!selectedProjectId || !projectAgentsData?.agents) return [];
    return projectAgentsData.agents.map(a => a.key);
  }, [selectedProjectId, projectAgentsData]);

  // Global thoughts query (always runs to seed the store on app start)
  const { data, isLoading, error } = useQuery({
    queryKey: ['thoughts'],
    queryFn: () => api.getThoughts(200),
    staleTime: 60000,
  });

  // Per-agent queries when a project is selected — ensures project agent
  // thoughts are loaded even if they'd be pushed out of the global top 200
  const agentThoughtQueries = useQueries({
    queries: projectAgentNames.map(name => ({
      queryKey: ['thoughts', 'agent', name],
      queryFn: () => api.getThoughts(200, name),
      staleTime: 60000,
    })),
  });

  // Populate thought store with global historical thoughts
  useEffect(() => {
    if (data?.thoughts && data.thoughts.length > 0) {
      const thoughts: Thought[] = data.thoughts.map((t) => ({
        id: t.id,
        agent_name: t.agent_name,
        thought_type: t.thought_type as Thought['thought_type'],
        content: t.content,
        tool_name: t.tool_name,
        tool_input: t.tool_input,
        tool_response: t.tool_response,
        timestamp: t.timestamp,
      }));
      addThoughts(thoughts);
    }
  }, [data, addThoughts]);

  // Collect per-agent query data into a stable reference (useQueries returns
  // a new array every render, which would cause the effect to fire constantly).
  const agentThoughtData = useMemo(
    () => agentThoughtQueries.map(q => q.data).filter(Boolean),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentThoughtQueries.map(q => q.dataUpdatedAt).join(',')],
  );

  // Populate thought store with project-specific thoughts
  useEffect(() => {
    for (const queryData of agentThoughtData) {
      if (queryData?.thoughts && queryData.thoughts.length > 0) {
        const thoughts: Thought[] = queryData.thoughts.map((t) => ({
          id: t.id,
          agent_name: t.agent_name,
          thought_type: t.thought_type as Thought['thought_type'],
          content: t.content,
          tool_name: t.tool_name,
          tool_input: t.tool_input,
          tool_response: t.tool_response,
          timestamp: t.timestamp,
        }));
        addThoughts(thoughts);
      }
    }
  }, [agentThoughtData, addThoughts]);

  return { thoughts: data?.thoughts || [], isLoading, error };
}
