import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * Polls for a pending opencode `question` tool call on the given agent.
 *
 * There's no WebSocket push for this (deliberately — see
 * services/opencode_questions.py's module docstring): opencode's
 * `question` tool blocks synchronously in the agent's own TUI, and the
 * bridge plugin only ever reports a tool call *after* it completes, so
 * there's no event to push in the first place. Polling is the primary
 * mechanism here, not a background fallback, hence the short interval —
 * this is specifically for "is my agent blocked waiting on me right now,"
 * where a stale answer for tens of seconds defeats the point.
 *
 * Only polls while a chat for a specific agent is actually open
 * (`enabled: !!agentId`) — this is not a global "check every agent"
 * poll.
 */
export function usePendingQuestion(agentId: string | undefined) {
  return useQuery({
    queryKey: ['pending-question', agentId],
    queryFn: () => api.getPendingQuestion(agentId!),
    enabled: !!agentId,
    refetchInterval: 5_000,
    // A stale question card (still showing options after it's already
    // been answered elsewhere, e.g. from the terminal) is actively
    // misleading, unlike most other polled data in this app — refetch
    // eagerly rather than trusting a cached "still pending" result.
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}
