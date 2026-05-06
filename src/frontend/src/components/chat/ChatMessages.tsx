import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage, getSystemNotificationInfo } from './ChatMessage';
import { MessageSquare, ArrowDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useActivityStore } from '@/stores/activityStore';
import { useThoughtStore, type Thought } from '@/stores/thoughtStore';
import { api } from '@/lib/api';
import type { Message } from '@/types/message';
import type { Activity } from '@/types/activity';

interface ChatMessagesProps {
  messages: Message[];
  onSuggestionClick?: (text: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

const suggestions = [
  'Check the mailbox for pending tasks',
  'Create a worker to review code',
  'What can you help me with?',
];

const SCROLL_THRESHOLD = 100; // pixels from bottom to consider "near bottom"

export function ChatMessages({ messages, onSuggestionClick, onLoadMore, hasMore, isLoadingMore }: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessageCountRef = useRef(messages.length);
  const { activities } = useActivityStore();
  const { thoughts } = useThoughtStore();

  // Memoize sorted messages to prevent re-sorting on every render
  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
    [messages]
  );

  // Collect non-user message IDs for bulk API fetch
  const agentMessageIds = useMemo(
    () =>
      sortedMessages
        .filter((m) => m.type !== 'user' && m.from_agent !== 'user')
        .map((m) => m.id),
    [sortedMessages]
  );

  // Fetch persisted tool calls from SQLite, keyed by message_id
  const { data: persistedEvents } = useQuery({
    queryKey: ['events-by-messages', agentMessageIds],
    queryFn: () => api.getEventsByMessages(agentMessageIds),
    enabled: agentMessageIds.length > 0,
    staleTime: 30_000, // refetch every 30s to pick up newly-linked events
    refetchOnWindowFocus: false,
  });

  // Build tool calls map: merge persisted (SQLite) + live (activity store)
  const toolCallsByMessage = useMemo(() => {
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

    // 2) Live events from activity store (for the most recent message
    //    where events haven't been linked to a message_id yet)
    const liveToolCalls = activities
      .filter((a) => a.type === 'tool_call')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Only supplement the last agent message with live events
    // (earlier messages should already have persisted events)
    for (let i = sortedMessages.length - 1; i >= 0; i--) {
      const msg = sortedMessages[i];
      const isUser = msg.type === 'user' || msg.from_agent === 'user';
      if (isUser) continue;

      // If this message already has persisted events, we're done
      if (map.has(msg.id) && map.get(msg.id)!.length > 0) break;

      // Find live tool calls in the timestamp window
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

      // Only do this for the last few messages
      break;
    }

    return map;
  }, [sortedMessages, activities, persistedEvents]);

  // Fetch persisted thoughts from API (survives page refresh)
  const { data: persistedThoughtsData } = useQuery({
    queryKey: ['thoughts'],
    queryFn: () => api.getThoughts(200),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Merge persisted (API) + live (WebSocket) thoughts, deduplicating by id
  const allThoughts = useMemo(() => {
    const persisted = (persistedThoughtsData?.thoughts || []) as Thought[];
    const liveIds = new Set(thoughts.map((t) => t.id));
    return [
      ...thoughts,
      ...persisted.filter((t) => !liveIds.has(t.id)),
    ];
  }, [thoughts, persistedThoughtsData]);

  // Build thoughts map: correlate thoughts to messages by timestamp window
  const thoughtsByMessage = useMemo(() => {
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
        // Match by agent name if available
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

  // Collapse consecutive identical messages: system notifications by label, regular messages by content+sender
  const collapsedMessages = useMemo(() => {
    const result: { message: Message; collapseCount?: number }[] = [];

    for (let i = 0; i < sortedMessages.length; i++) {
      const msg = sortedMessages[i];
      const info = getSystemNotificationInfo(msg);

      if (info) {
        // Count consecutive system notifications with the same label
        let count = 1;
        while (i + count < sortedMessages.length) {
          const nextMsg = sortedMessages[i + count];
          const nextInfo = getSystemNotificationInfo(nextMsg);
          if (nextInfo && nextInfo.label === info.label) {
            count++;
          } else {
            break;
          }
        }
        // Show only the last message of the group, with a count badge
        result.push({ message: sortedMessages[i + count - 1], collapseCount: count });
        i += count - 1;
        continue;
      }

      // Content-based dedup: collapse consecutive identical messages from the same sender
      let count = 1;
      while (i + count < sortedMessages.length) {
        const nextMsg = sortedMessages[i + count];
        if (getSystemNotificationInfo(nextMsg)) break;
        if (nextMsg.from_agent === msg.from_agent && nextMsg.content === msg.content) {
          count++;
        } else {
          break;
        }
      }
      result.push({ message: sortedMessages[i + count - 1], collapseCount: count > 1 ? count : undefined });
      i += count - 1;
    }

    return result;
  }, [sortedMessages]);

  // Track scroll position to determine if user is near bottom
  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD;

    setIsNearBottom(nearBottom);
    // Clear unread count when user scrolls to bottom
    if (nearBottom) {
      setUnreadCount(0);
    }
  }, []);

  // Scroll to bottom function
  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'instant',
    });
    setUnreadCount(0);
  }, []);

  // Scroll to bottom on initial mount when messages exist
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      initialScrollDone.current = true;
      requestAnimationFrame(() => {
        scrollToBottom(false);
      });
    }
  }, [messages.length, scrollToBottom]);

  // Track new messages - auto-scroll if near bottom, otherwise update unread count
  useEffect(() => {
    const newMessageCount = messages.length;
    const newMessages = newMessageCount - prevMessageCountRef.current;

    if (newMessages > 0) {
      if (isNearBottom) {
        // User is at bottom, keep them there
        requestAnimationFrame(() => {
          scrollToBottom(false);
        });
      } else {
        // User is reading history, increment unread count
        setUnreadCount((prev) => prev + newMessages);
      }
    }

    prevMessageCountRef.current = newMessageCount;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Scroll to bottom on agent switch (messages array reference changes)
  const messagesRef = useRef(messages);
  useEffect(() => {
    // Check if this is a different agent's messages (array reference changed completely)
    const isAgentSwitch =
      messages !== messagesRef.current &&
      messages.length > 0 &&
      (messagesRef.current.length === 0 ||
        messages[0]?.id !== messagesRef.current[0]?.id);

    if (isAgentSwitch) {
      // Reset unread count and scroll to bottom for new agent
      setUnreadCount(0);
      initialScrollDone.current = true; // Don't double-scroll
      prevMessageCountRef.current = messages.length;
      requestAnimationFrame(() => {
        scrollToBottom(false);
      });
    }

    messagesRef.current = messages;
  }, [messages, scrollToBottom]);

  // Infinite scroll: load older messages when user scrolls to top
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport || !onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !isLoadingMore) {
          // Save scroll height before loading more so we can restore position
          const prevScrollHeight = viewport.scrollHeight;
          const prevScrollTop = viewport.scrollTop;

          onLoadMore();

          // After new messages are prepended, restore scroll position
          requestAnimationFrame(() => {
            const newScrollHeight = viewport.scrollHeight;
            const heightDiff = newScrollHeight - prevScrollHeight;
            viewport.scrollTop = prevScrollTop + heightDiff;
          });
        }
      },
      {
        root: viewport,
        rootMargin: '100px 0px 0px 0px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore, hasMore, isLoadingMore]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">Ready to work</h3>
          <p className="text-sm text-muted-foreground mb-6">
            Send a task to the supervisor agent. It will delegate work to specialized workers
            and coordinate the results.
          </p>
          {onSuggestionClick && (
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => onSuggestionClick(suggestion)}
                  className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-full transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      <ScrollArea
        className="flex-1"
        viewportRef={viewportRef}
        onScroll={handleScroll}
      >
        <div className="p-4 space-y-4">
          {/* Top sentinel for infinite scroll */}
          <div ref={topSentinelRef} className="h-1" />
          {isLoadingMore && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
            </div>
          )}
          {collapsedMessages.map(({ message, collapseCount }) => (
            <ChatMessage
              key={message.id}
              message={message}
              toolCalls={toolCallsByMessage.get(message.id)}
              thoughts={thoughtsByMessage.get(message.id)}
              collapseCount={collapseCount}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom indicator with unread count - absolutely positioned outside ScrollArea */}
      {unreadCount > 0 && !isNearBottom && (
        <div className="absolute bottom-4 right-4 z-10">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => scrollToBottom(true)}
            className="relative h-10 w-10 rounded-full shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <ArrowDown className="h-5 w-5" />
            <Badge
              variant="destructive"
              className="absolute -top-2 -right-2 h-5 min-w-5 px-1.5 flex items-center justify-center"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          </Button>
        </div>
      )}
    </div>
  );
}
