import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useTasks(project?: string) {
  return useQuery({
    queryKey: ['tasks-tree', project],
    queryFn: () => api.getTaskTree({ project, include_done: true }),
    staleTime: 30_000,
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, update }: { taskId: string; update: { status?: string; assigned_to?: string } }) =>
      api.updateTask(taskId, update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks-tree'] });
    },
  });
}
