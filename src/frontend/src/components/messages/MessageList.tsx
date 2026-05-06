import { useMessages } from '@/hooks/useMessages';
import { ScrollArea } from '../ui/scroll-area';
import { UserMessage } from './UserMessage';

export function MessageList() {
  const { messages, isLoading, error } = useMessages();

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading messages...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-500">
        Failed to load messages
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Messages</h2>
        <p className="text-sm text-muted-foreground">
          {messages.length} messages
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {messages.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No messages yet
            </p>
          ) : (
            messages.map((message) => (
              <UserMessage key={message.id} message={message} />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
