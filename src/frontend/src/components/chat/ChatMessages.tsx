import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { MessageSquare } from 'lucide-react';
import { useMessageFeed } from '@/hooks/useMessageFeed';
import { useScrollAnchor, useInfiniteScrollTop } from '@/hooks/useScrollAnchor';
import { LoadingMoreRow, ScrollToBottomButton } from './MessageFeedChrome';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { Message } from '@/types/message';

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

export function ChatMessages({
  messages,
  onSuggestionClick,
  onLoadMore,
  hasMore,
  isLoadingMore,
}: ChatMessagesProps) {
  const isMobile = useIsMobile();
  const { collapsedMessages, toolCallsByMessage, thoughtsByMessage } = useMessageFeed(messages);
  const { viewportRef, bottomRef, isNearBottom, unreadCount, handleScroll, scrollToBottom } =
    useScrollAnchor(messages);
  const topSentinelRef = useInfiniteScrollTop({ viewportRef, onLoadMore, hasMore, isLoadingMore });

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
      <ScrollArea className="flex-1" viewportRef={viewportRef} onScroll={handleScroll}>
        {/* space-y-4 (16px) between EVERY message plus p-4 all around was
            never mobile-aware — on a phone-width column that's a lot of
            dead vertical space between short back-to-back messages.
            ChatMessage's own mobile layout already handles compact
            per-message spacing (py-1.5, mb-0.5), so the list container
            just needs to get out of the way with a much smaller gap. */}
        <div className={cn(isMobile ? 'p-2 space-y-0.5' : 'p-4 space-y-4')}>
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
