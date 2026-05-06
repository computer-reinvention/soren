import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage, getSystemNotificationInfo } from './ChatMessage';
import { MarkdownContent } from './MarkdownContent';
import { ArrowDown, Loader2, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { parseMessagePrefix } from '@/lib/utils';
import { useActivityStore } from '@/stores/activityStore';
import { useThoughtStore, type Thought } from '@/stores/thoughtStore';
import { api } from '@/lib/api';
import type { Message } from '@/types/message';
import type { Activity } from '@/types/activity';

interface InboxViewProps {
  messages: Message[];
  agentId: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

const SCROLL_THRESHOLD = 100;

/**
 * Inbox view for worker agents — shows a pinned task card at top
 * and all messages in a chronological feed with worker-centric alignment.
 */
export function InboxView({ messages, agentId, onLoadMore, hasMore, isLoadingMore }: InboxViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const prevMessageCountRef = useRef(messages.length);
  const { activities } = useActivityStore();
  const { thoughts } = useThoughtStore();

  // Sort messages chronologically (oldest first)
  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      ),
    [messages]
  );

  // Find the pinned task: first [TASK] message sent TO this worker
  const pinnedTask = useMemo(() => {
    for (const msg of sortedMessages) {
      if (msg.to_agent === agentId) {
        const prefix = parseMessagePrefix(msg.content);
        if (prefix && prefix.label === 'TASK') {
          return { message: msg, content: prefix.rest };
        }
      }
    }
    return null;
  }, [sortedMessages, agentId]);

  // Collect non-user message IDs for bulk API fetch
  const agentMessageIds = useMemo(
    () =>
      sortedMessages
        .filter((m) => m.type !== 'user' && m.from_agent !== 'user')
        .map((m) => m.id),
    [sortedMessages]
  );

  // Fetch persisted tool calls from SQLite
  const { data: persistedEvents } = useQuery({
    queryKey: ['events-by-messages', agentMessageIds],
    queryFn: () => api.getEventsByMessages(agentMessageIds),
    enabled: agentMessageIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  // Build tool calls map
  const toolCallsByMessage = useMemo(() => {
    const map = new Map<string, Activity[]>();

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

    const liveToolCalls = activities
      .filter((a) => a.type === 'tool_call')
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    for (let i = sortedMessages.length - 1; i >= 0; i--) {
      const msg = sortedMessages[i];
      const isUser = msg.type === 'user' || msg.from_agent === 'user';
      if (isUser) continue;

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
      break;
    }

    return map;
  }, [sortedMessages, activities, persistedEvents]);

  // Fetch persisted thoughts
  const { data: persistedThoughtsData } = useQuery({
    queryKey: ['thoughts'],
    queryFn: () => api.getThoughts(200),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const allThoughts = useMemo(() => {
    const persisted = (persistedThoughtsData?.thoughts || []) as Thought[];
    const liveIds = new Set(thoughts.map((t) => t.id));
    return [
      ...thoughts,
      ...persisted.filter((t) => !liveIds.has(t.id)),
    ];
  }, [thoughts, persistedThoughtsData]);

  // Build thoughts map
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

  // Scroll tracking
  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const nearBottom = distanceFromBottom < SCROLL_THRESHOLD;

    setIsNearBottom(nearBottom);
    if (nearBottom) {
      setUnreadCount(0);
    }
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'instant',
    });
    setUnreadCount(0);
  }, []);

  // Initial scroll
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (!initialScrollDone.current && messages.length > 0) {
      initialScrollDone.current = true;
      requestAnimationFrame(() => {
        scrollToBottom(false);
      });
    }
  }, [messages.length, scrollToBottom]);

  // New message tracking
  useEffect(() => {
    const newMessageCount = messages.length;
    const newMessages = newMessageCount - prevMessageCountRef.current;

    if (newMessages > 0) {
      if (isNearBottom) {
        requestAnimationFrame(() => {
          scrollToBottom(false);
        });
      } else {
        setUnreadCount((prev) => prev + newMessages);
      }
    }

    prevMessageCountRef.current = newMessageCount;
  }, [messages.length, isNearBottom, scrollToBottom]);

  // Agent switch scroll reset
  const messagesRef = useRef(messages);
  useEffect(() => {
    const isAgentSwitch =
      messages !== messagesRef.current &&
      messages.length > 0 &&
      (messagesRef.current.length === 0 ||
        messages[0]?.id !== messagesRef.current[0]?.id);

    if (isAgentSwitch) {
      setUnreadCount(0);
      initialScrollDone.current = true;
      prevMessageCountRef.current = messages.length;
      requestAnimationFrame(() => {
        scrollToBottom(false);
      });
    }

    messagesRef.current = messages;
  }, [messages, scrollToBottom]);

  // Infinite scroll
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const viewport = viewportRef.current;
    if (!sentinel || !viewport || !onLoadMore || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !isLoadingMore) {
          const prevScrollHeight = viewport.scrollHeight;
          const prevScrollTop = viewport.scrollTop;

          onLoadMore();

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
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No messages yet</h3>
          <p className="text-sm text-muted-foreground">
            This worker hasn&apos;t received any tasks yet. Assign a task from the supervisor.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col relative overflow-hidden">
      {/* Pinned task card */}
      {pinnedTask && (
        <div className="border-b bg-muted/30 px-4 py-3 flex-shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <ClipboardList className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
            <span className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide">Task</span>
            <span className="text-[10px] text-muted-foreground">
              from {pinnedTask.message.from_agent}
            </span>
          </div>
          <div className="text-sm text-foreground/90 line-clamp-3">
            <MarkdownContent
              content={pinnedTask.content}
              className="text-sm [&_p]:mb-0.5 [&_p]:last:mb-0"
            />
          </div>
        </div>
      )}

      {/* Message feed */}
      <ScrollArea
        className="flex-1"
        viewportRef={viewportRef}
        onScroll={handleScroll}
      >
        <div className="p-4 space-y-4">
          <div ref={topSentinelRef} className="h-1" />
          {isLoadingMore && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="ml-2 text-xs text-muted-foreground">Loading older messages...</span>
            </div>
          )}
          {collapsedMessages.map(({ message, collapseCount }) => (
            <InboxMessage
              key={message.id}
              message={message}
              agentId={agentId}
              toolCalls={toolCallsByMessage.get(message.id)}
              thoughts={thoughtsByMessage.get(message.id)}
              collapseCount={collapseCount}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Scroll to bottom */}
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

/**
 * Inbox message — passes inboxAgentId to ChatMessage so it uses
 * worker-centric alignment (worker's messages left, everything else right).
 */
function InboxMessage({
  message,
  agentId,
  toolCalls,
  thoughts,
  collapseCount,
}: {
  message: Message;
  agentId: string;
  toolCalls?: Activity[];
  thoughts?: Thought[];
  collapseCount?: number;
}) {
  return (
    <ChatMessage
      message={message}
      toolCalls={toolCalls}
      thoughts={thoughts}
      collapseCount={collapseCount}
      inboxAgentId={agentId}
    />
  );
}
