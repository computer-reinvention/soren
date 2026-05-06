import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAgentStore } from '../stores/agentStore';
import { useEffect } from 'react';

export function useAgents() {
  const { setAgents } = useAgentStore();

  const query = useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
  });

  useEffect(() => {
    if (query.data) {
      setAgents(query.data.agents);
    }
  }, [query.data, setAgents]);

  return query;
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.getAgent(id),
    enabled: !!id,
  });
}
