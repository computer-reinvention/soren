import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { useMessages } from '@/hooks/useMessages';
import { JournalViewer } from '../journal/JournalViewer';
import type { Message } from '@/types/message';

type Tab = 'chat' | 'journal';

export function CommandCenter() {
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('chat');
  const { messages: loadedMessages } = useMessages();

  const sendMutation = useMutation({
    mutationFn: (content: string) => api.sendMessageToAgent('supervisor', content),
    onSuccess: () => setMessage(''),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !sendMutation.isPending) {
      sendMutation.mutate(message.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-xl font-semibold">Command Center</h2>
            <p className="text-sm text-muted-foreground">Send tasks to the supervisor agent</p>
          </div>
          <div className="flex gap-1 bg-muted p-1 rounded-lg">
            <Button
              variant={activeTab === 'chat' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('chat')}
            >
              💬 Chat
            </Button>
            <Button
              variant={activeTab === 'journal' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('journal')}
            >
              📓 Journal
            </Button>
          </div>
        </div>
      </div>

      {activeTab === 'chat' ? (
        <>
          {/* Message History */}
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4">
              {loadedMessages.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-4xl mb-4">🤖</div>
                  <h3 className="text-lg font-medium mb-2">Ready to work</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Send a task to the supervisor agent. It will delegate work to specialized workers
                    and coordinate the results.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <SuggestionChip onClick={(t) => setMessage(t)}>
                      Check the mailbox for pending tasks
                    </SuggestionChip>
                    <SuggestionChip onClick={(t) => setMessage(t)}>
                      Create a worker to review code
                    </SuggestionChip>
                    <SuggestionChip onClick={(t) => setMessage(t)}>
                      What can you help me with?
                    </SuggestionChip>
                  </div>
                </div>
              ) : (
                [...loadedMessages].reverse().map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))
              )}
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="p-4 border-t bg-muted/30">
            <form onSubmit={handleSubmit}>
              <div className="flex gap-2">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe a task for the supervisor... (Enter to send, Shift+Enter for new line)"
                  className="flex-1 min-h-[80px] max-h-[200px] p-3 rounded-lg border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  disabled={sendMutation.isPending}
                />
                <Button
                  type="submit"
                  disabled={!message.trim() || sendMutation.isPending}
                  className="self-end h-10"
                >
                  {sendMutation.isPending ? '...' : 'Send'}
                </Button>
              </div>
              {sendMutation.isError && (
                <p className="mt-2 text-sm text-red-500">Failed to send message. Try again.</p>
              )}
            </form>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          <JournalViewer />
        </div>
      )}
    </div>
  );
}

function SuggestionChip({ children, onClick }: { children: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(children)}
      className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 rounded-full transition-colors"
    >
      {children}
    </button>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.type === 'user' || message.from_agent === 'user';
  const time = new Date(message.timestamp).toLocaleTimeString();

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <Card className={`max-w-[80%] ${isUser ? 'bg-primary text-primary-foreground' : ''}`}>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={isUser ? 'secondary' : 'outline'} className="text-xs">
              {isUser ? 'You' : message.from_agent}
            </Badge>
            <span className="text-xs opacity-70">{time}</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        </CardContent>
      </Card>
    </div>
  );
}
