import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useHealthCheck() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
}
