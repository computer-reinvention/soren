import { useAgents } from '@/hooks/useAgents';
import { useAgentStore } from '@/stores/agentStore';
import { AgentCard } from './AgentCard';
import { ScrollArea } from '../ui/scroll-area';

export function AgentList() {
  const { selectedAgentId, selectAgent } = useAgentStore();
  const { data, isLoading, error } = useAgents();

  if (isLoading) {
    return <div className="p-4">Loading agents...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-500">Failed to load agents</div>;
  }

  const agents = data?.agents || [];

  // Sort: supervisor first, then by name
  const sortedAgents = [...agents].sort((a, b) => {
    if (a.type === 'supervisor') return -1;
    if (b.type === 'supervisor') return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b">
        <h2 className="font-semibold text-lg">Agents</h2>
        <p className="text-sm text-muted-foreground">
          {agents.length} active
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {sortedAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              isSelected={selectedAgentId === agent.id}
              onClick={() => selectAgent(agent.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
