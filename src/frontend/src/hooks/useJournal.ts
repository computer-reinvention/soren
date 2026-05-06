import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { JournalEntryCreate } from '../types/journal';

export function useJournal(date?: string, projectId?: string | null) {
  return useQuery({
    queryKey: ['journal', date, projectId],
    queryFn: () => projectId ? api.getJournalForProject(date, projectId) : api.getJournal(date),
  });
}

export function useJournalDates() {
  return useQuery({
    queryKey: ['journal-dates'],
    queryFn: () => api.getJournalDates(),
  });
}

export function useJournalSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['journal-search', query],
    queryFn: () => api.searchJournal(query),
    enabled: enabled && query.length > 0,
  });
}

export function useRecurringIssues() {
  return useQuery({
    queryKey: ['journal-recurring-issues'],
    queryFn: () => api.getRecurringIssues(),
    refetchInterval: 60_000,
  });
}

export function useWeeklySummary(weeksAgo = 0) {
  return useQuery({
    queryKey: ['journal-weekly-summary', weeksAgo],
    queryFn: () => api.getWeeklySummary(weeksAgo),
  });
}

export function useCorrectionCompliance() {
  return useQuery({
    queryKey: ['journal-correction-compliance'],
    queryFn: () => api.getCorrectionCompliance(),
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
