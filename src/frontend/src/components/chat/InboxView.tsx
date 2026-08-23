import { useMemo } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { MarkdownContent } from './MarkdownContent';
import { ClipboardList } from 'lucide-react';
import { parseMessagePrefix } from '@/lib/utils';
import { useMessageFeed } from '@/hooks/useMessageFeed';
import { useScrollAnchor, useInfiniteScrollTop } from '@/hooks/useScrollAnchor';
import { LoadingMoreRow, ScrollToBottomButton } from './MessageFeedChrome';
import type { Message } from '@/types/message';

interface InboxViewProps {
  messages: Message[];
  agentId: string;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
}

/**
 * Worker-scoped feed: identical to ChatMessages except for the pinned
 * [TASK] card and the empty state. All feed logic lives in the shared
 * useMessageFeed/useScrollAnchor hooks.
 */
export function InboxView({ messages, agentId, onLoadMore, hasMore, isLoadingMore }: InboxViewProps) {
  const { sortedMessages, collapsedMessages, toolCallsByMessage, thoughtsByMessage } =
    useMessageFeed(messages);
  const { viewportRef, bottomRef, isNearBottom, unreadCount, handleScroll, scrollToBottom } =
    useScrollAnchor(messages);
  const topSentinelRef = useInfiniteScrollTop({ viewportRef, onLoadMore, hasMore, isLoadingMore });

  // Pinned task: first [TASK] message sent TO this worker
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
      <ScrollArea className="flex-1" viewportRef={viewportRef} onScroll={handleScroll}>
        <div className="p-4 space-y-4">
          <div ref={topSentinelRef} className="h-1" />
          <LoadingMoreRow visible={isLoadingMore} />
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

      <ScrollToBottomButton
        unreadCount={unreadCount}
        isNearBottom={isNearBottom}
        onClick={() => scrollToBottom(true)}
      />
    </div>
  );
}
