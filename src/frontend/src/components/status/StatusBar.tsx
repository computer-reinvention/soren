import { useConnectionStore } from '@/stores/connectionStore';
import { useAgentStore } from '@/stores/agentStore';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';

export function StatusBar() {
  const { isConnected, isReconnecting } = useConnectionStore();
  const { agents } = useAgentStore();

  const activeAgents = agents.filter(
    (a) => a.status === 'IN_PROGRESS'
  ).length;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-8 bg-background border-t flex items-center justify-between px-4 text-sm">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'w-2 h-2 rounded-full',
              isConnected ? 'bg-green-500' : 'bg-red-500',
              isReconnecting && 'animate-pulse bg-yellow-500'
            )}
          />
          <span>
            {isReconnecting
              ? 'Reconnecting...'
              : isConnected
              ? 'Connected'
              : 'Disconnected'}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <span>{agents.length} agents</span>
        <Badge variant={activeAgents > 0 ? 'default' : 'secondary'}>
          {activeAgents} active
        </Badge>
      </div>
    </div>
  );
}
