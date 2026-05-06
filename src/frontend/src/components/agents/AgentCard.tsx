import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import type { Agent, AgentStatus } from '@/types/agent';

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
}

const statusColors: Record<AgentStatus, string> = {
  IDLE: 'bg-gray-500',
  PENDING: 'bg-yellow-500',
  IN_PROGRESS: 'bg-blue-500',
  BLOCKED: 'bg-red-500',
  TESTING: 'bg-purple-500',
  COMPLETE: 'bg-green-500',
  FAILED: 'bg-red-700',
  SLEEPING: 'bg-indigo-400',
};

export function AgentCard({ agent, isSelected, onClick }: AgentCardProps) {
  return (
    <Card
      className={cn(
        'p-3 cursor-pointer transition-colors hover:bg-muted/50',
        isSelected && 'border-primary bg-muted'
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              statusColors[agent.status]
            )}
          />
          <span className="font-medium">{agent.name}</span>
        </div>
        <Badge variant={agent.type === 'supervisor' ? 'default' : 'secondary'}>
          {agent.type}
        </Badge>
      </div>

      {agent.current_task && (
        <p className="mt-2 text-sm text-muted-foreground truncate">
          {agent.current_task}
        </p>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        {agent.last_activity
          ? `Active ${formatRelativeTime(agent.last_activity)}`
          : 'No recent activity'}
      </p>
    </Card>
  );
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}
