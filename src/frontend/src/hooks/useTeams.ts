import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: () => api.getTeams(),
  });
}
