import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActivityStore } from '@/stores/activityStore';
import { useThoughtStore, type Thought } from '@/stores/thoughtStore';
import { api } from '@/lib/api';
import { getSystemNotificationInfo } from '@/components/chat/ChatMessage';
import type { Message } from '@/types/message';
import type { Activity } from '@/types/activity';

/**
 * Shared message-feed data pipeline (P2.5 dedupe): sorting, tool-call
 * correlation, thought correlation, and collapsing were duplicated ~verbatim
 * between ChatMessages and InboxView (~300 lines). Both now consume these
 * hooks; query keys are unchanged, so caching behavior is identical.
 */

export function useSortedMessages(messages: Message[]): Message[] {
  return useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
    [messages]
  );
}

/**
 * Tool calls per message id. Two sources, merged:
 *  1) persisted agent events from SQLite (linked by message_id)
 *  2) live activity-store events, correlated to the LAST agent message that
 *     lacks persisted events via (prevMsg.ts, msg.ts] window + agent match
 */
export function useToolCorrelation(sortedMessages: Message[]): Map<string, Activity[]> {
  const { activities } = useActivityStore();

  const agentMessageIds = useMemo(
    () =>
      sortedMessages
        .filter((m) => m.type !== 'user' && m.from_agent !== 'user')
        .map((m) => m.id),
    [sortedMessages]
  );

  const { data: persistedEvents } = useQuery({
    queryKey: ['events-by-messages', agentMessageIds],
    queryFn: () => api.getEventsByMessages(agentMessageIds),
    enabled: agentMessageIds.length > 0,
    staleTime: 30_000, // refetch every 30s to pick up newly-linked events
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const map = new Map<string, Activity[]>();

    // 1) Persisted events from SQLite (these have message_id set)
    if (persistedEvents) {
      for (const [msgId, events] of Object.entries(persistedEvents)) {
        if (events && events.length > 0) {
          map.set(
            msgId,
            events.map((e) => ({
              id: e.id,
              timestamp: e.timestamp,
              type: 'tool_call' as const,
              agent_id: e.agent_id || '',
              data: {
                tool_name: e.tool_name,
                tool_input: e.tool_input,
                tool_output: e.tool_output,
              },
            }))
          );
        }
      }
    }

    // 2) Live events for the most recent message not yet linked in SQLite
    const liveToolCalls = activities
      .filter((a) => a.type === 'tool_call')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (let i = sortedMessages.length - 1; i >= 0; i--) {
      const msg = sortedMessages[i];
      const isUser = msg.type === 'user' || msg.from_agent === 'user';
      if (isUser) continue;

      // If this message already has persisted events, we're done
      if (map.has(msg.id) && map.get(msg.id)!.length > 0) break;

      const prevMsg = sortedMessages[i - 1];
      const startTs = prevMsg ? new Date(prevMsg.timestamp).getTime() : 0;
      const endTs = new Date(msg.timestamp).getTime();

      const relevant = liveToolCalls.filter((tc) => {
        const tcTs = new Date(tc.timestamp).getTime();
        if (tcTs <= startTs || tcTs > endTs) return false;
        if (msg.from_agent && msg.from_agent !== 'user') {
          return (
            tc.agent_id === msg.from_agent ||
            tc.agent_id.toLowerCase().includes(msg.from_agent.toLowerCase())
          );
        }
        return true;
      });

      if (relevant.length > 0) {
        map.set(msg.id, relevant);
      }

      // Live correlation applies to the last agent message only
      break;
    }

    return map;
  }, [sortedMessages, activities, persistedEvents]);
}

/**
 * Thoughts per message id: live (WebSocket) + persisted (API) merged and
 * deduped by id, then correlated per message via (prevMsg.ts, msg.ts]
 * window + agent-name match. Runs over ALL agent messages.
 */
export function useThoughtCorrelation(sortedMessages: Message[]): Map<string, Thought[]> {
  const { thoughts } = useThoughtStore();

  const { data: persistedThoughtsData } = useQuery({
    queryKey: ['thoughts'],
    queryFn: () => api.getThoughts(200),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const allThoughts = useMemo(() => {
    const persisted = (persistedThoughtsData?.thoughts || []) as Thought[];
    const liveIds = new Set(thoughts.map((t) => t.id));
    return [...thoughts, ...persisted.filter((t) => !liveIds.has(t.id))];
  }, [thoughts, persistedThoughtsData]);

  return useMemo(() => {
    const map = new Map<string, Thought[]>();
    if (allThoughts.length === 0) return map;

    const sortedThoughts = [...allThoughts].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (let i = 0; i < sortedMessages.length; i++) {
      const msg = sortedMessages[i];
      const isUser = msg.type === 'user' || msg.from_agent === 'user';
      if (isUser) continue;

      const prevMsg = sortedMessages[i - 1];
      const startTs = prevMsg ? new Date(prevMsg.timestamp).getTime() : 0;
      const endTs = new Date(msg.timestamp).getTime();

      const relevant = sortedThoughts.filter((t) => {
        const tTs = new Date(t.timestamp).getTime();
        if (tTs <= startTs || tTs > endTs) return false;
        if (msg.from_agent && msg.from_agent !== 'user') {
          return (
            t.agent_name === msg.from_agent ||
            t.agent_name.toLowerCase().includes(msg.from_agent.toLowerCase())
          );
        }
        return true;
      });

      if (relevant.length > 0) {
        map.set(msg.id, relevant);
      }
    }

    return map;
  }, [sortedMessages, allThoughts]);
}

export interface CollapsedMessage {
  message: Message;
  collapseCount?: number;
}

/**
 * Collapse consecutive identical messages: system notifications by label
 * (always sets collapseCount), regular messages by content+sender
 * (collapseCount only when > 1).
 */
export function useCollapsedMessages(sortedMessages: Message[]): CollapsedMessage[] {
  return useMemo(() => {
    const result: CollapsedMessage[] = [];

    for (let i = 0; i < sortedMessages.length; i++) {
      const msg = sortedMessages[i];
      const info = getSystemNotificationInfo(msg);

      if (info) {
        let count = 1;
        while (i + count < sortedMessages.length) {
          const nextInfo = getSystemNotificationInfo(sortedMessages[i + count]);
          if (nextInfo && nextInfo.label === info.label) count++;
          else break;
        }
        result.push({ message: sortedMessages[i + count - 1], collapseCount: count });
        i += count - 1;
        continue;
      }

      let count = 1;
      while (i + count < sortedMessages.length) {
        const nextMsg = sortedMessages[i + count];
        if (getSystemNotificationInfo(nextMsg)) break;
        if (nextMsg.from_agent === msg.from_agent && nextMsg.content === msg.content) count++;
        else break;
      }
      result.push({
        message: sortedMessages[i + count - 1],
        collapseCount: count > 1 ? count : undefined,
      });
      i += count - 1;
    }

    return result;
  }, [sortedMessages]);
}

/** Facade composing the full data pipeline. */
export function useMessageFeed(messages: Message[]) {
  const sortedMessages = useSortedMessages(messages);
  const toolCallsByMessage = useToolCorrelation(sortedMessages);
  const thoughtsByMessage = useThoughtCorrelation(sortedMessages);
  const collapsedMessages = useCollapsedMessages(sortedMessages);
  return { sortedMessages, toolCallsByMessage, thoughtsByMessage, collapsedMessages };
}
