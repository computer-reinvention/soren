import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { JournalEntryCreate, JournalScope } from '../types/journal';

// scope/team select which journal to read: "supervisor" (default, the
// single global journal) or "team" with a team prefix. This is the
// dashboard's own oversight surface — not something exposed to any
// agent-facing tool (see the journal skill).
export function useJournal(date?: string, projectId?: string | null, scope: JournalScope = 'supervisor', team?: string) {
  return useQuery({
    queryKey: ['journal', date, projectId, scope, team],
    queryFn: () => api.getJournal(date, { project: projectId ?? undefined, scope, team }),
  });
}

export function useJournalDates(scope: JournalScope = 'supervisor', team?: string) {
  return useQuery({
    queryKey: ['journal-dates', scope, team],
    queryFn: () => api.getJournalDates({ scope, team }),
  });
}

// Team prefixes that have their own journal — populates the scope selector.
export function useJournalTeams() {
  return useQuery({
    queryKey: ['journal-teams'],
    queryFn: () => api.getJournalTeams(),
  });
}

export function useJournalSearch(query: string, enabled = true, scope: JournalScope = 'supervisor', team?: string) {
  return useQuery({
    queryKey: ['journal-search', query, scope, team],
    queryFn: () => api.searchJournal(query, 20, { scope, team }),
    enabled: enabled && query.length > 0,
  });
}

export function useRecurringIssues(team?: string) {
  return useQuery({
    queryKey: ['journal-recurring-issues', team],
    queryFn: () => api.getRecurringIssues(team),
    refetchInterval: 60_000,
  });
}

export function useWeeklySummary(weeksAgo = 0, team?: string) {
  return useQuery({
    queryKey: ['journal-weekly-summary', weeksAgo, team],
    queryFn: () => api.getWeeklySummary(weeksAgo, team),
  });
}

export function useCorrectionCompliance(team?: string) {
  return useQuery({
    queryKey: ['journal-correction-compliance', team],
    queryFn: () => api.getCorrectionCompliance(team),
    refetchInterval: 120_000,
  });
}

export function useAddJournalEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entry: JournalEntryCreate) => api.addJournalEntry(entry),
    onSuccess: () => {
      // Invalidate current day's journal
      queryClient.invalidateQueries({ queryKey: ['journal'] });
    },
  });
}
