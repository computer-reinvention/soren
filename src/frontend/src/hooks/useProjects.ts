import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.getProjects(),
  });
}

export function useProjectAgents(projectId: string | null) {
  return useQuery({
    queryKey: ['projectAgents', projectId],
    queryFn: () => api.getProjectAgents(projectId!),
    enabled: !!projectId,
  });
}
