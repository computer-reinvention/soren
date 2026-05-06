import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Message } from '@/types/message';
import { cn } from '@/lib/utils';

interface UserMessageProps {
  message: Message;
}

const typeColors: Record<Message['type'], string> = {
  task: 'bg-blue-500',
  status: 'bg-yellow-500',
  response: 'bg-green-500',
  error: 'bg-red-500',
  user: 'bg-purple-500',
  mailbox: 'bg-cyan-500',
  system: 'bg-gray-500',
};

export function UserMessage({ message }: UserMessageProps) {
  const time = new Date(message.timestamp).toLocaleTimeString();

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div
            className={cn('w-2 h-2 rounded-full', typeColors[message.type])}
          />
          <span className="text-sm font-medium">{message.from_agent}</span>
          <span className="text-xs text-muted-foreground">→</span>
          <span className="text-sm">{message.to_agent}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {message.type}
          </Badge>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
      </div>

      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
    </Card>
  );
}
