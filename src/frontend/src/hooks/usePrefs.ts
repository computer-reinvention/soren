import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Prefs } from '@/lib/api';
import { applyDensity } from '@/lib/density';

/**
 * Server-synced preferences (GET/PUT /api/prefs). Currently just heartbeat
 * config (HeartbeatIndicator.tsx, unaffected by this hook) plus `ui_density`
 * (P5.2 settings panel). Applies density to <html> as a side effect any time
 * the fetched value changes — mirrors themeStore's rehydration-applies-DOM
 * pattern, just server-sourced instead of localStorage-sourced.
 */
export function usePrefs() {
  const query = useQuery({
    queryKey: ['prefs'],
    queryFn: () => api.getPrefs(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) applyDensity(query.data.ui_density);
  }, [query.data]);

  return query;
}

export function useUpdatePrefs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<Prefs>) => api.updatePrefs(patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(['prefs'], updated);
      applyDensity(updated.ui_density);
    },
  });
}
