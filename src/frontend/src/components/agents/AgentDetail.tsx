import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAgentStore } from '@/stores/agentStore';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import { OutputPanel } from './OutputPanel';
import { TerminalView } from './TerminalView';
import type { AgentStatus } from '@/types/agent';

const statusLabels: Record<AgentStatus, { label: string; color: string }> = {
  IDLE: { label: 'Idle', color: 'bg-gray-500' },
  PENDING: { label: 'Pending', color: 'bg-yellow-500' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-blue-500' },
  BLOCKED: { label: 'Blocked', color: 'bg-red-500' },
  TESTING: { label: 'Testing', color: 'bg-purple-500' },
  COMPLETE: { label: 'Complete', color: 'bg-green-500' },
  FAILED: { label: 'Failed', color: 'bg-red-700' },
  SLEEPING: { label: 'Sleeping', color: 'bg-indigo-400' },
};

type ViewTab = 'terminal' | 'events';

export function AgentDetail() {
  const { agents, selectedAgentId, selectAgent } = useAgentStore();
  const [activeTab, setActiveTab] = useState<ViewTab>('terminal');
  const agent = agents.find((a) => a.id === selectedAgentId);

  const interruptMutation = useMutation({
    mutationFn: () => api.interruptAgent(selectedAgentId!),
  });

  const compactMutation = useMutation({
    mutationFn: () => api.compactAgent(selectedAgentId!),
  });

  if (!agent) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <div className="text-6xl mb-4">🤖</div>
        <h3 className="text-lg font-medium mb-2">No Agent Selected</h3>
        <p className="text-sm text-center">
          Select an agent from the sidebar to view its details, terminal output, and events.
        </p>
      </div>
    );
  }

  const statusInfo = statusLabels[agent.status];

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Agent Header Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${statusInfo.color} animate-pulse`} />
                <span>{agent.name}</span>
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant={agent.type === 'supervisor' ? 'default' : 'secondary'}>
                  {agent.type}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => selectAgent(null)}
                  className="h-7 text-xs"
                >
                  ✕ Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Status</p>
                <p className="font-medium">{statusInfo.label}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Window</p>
                <p className="font-mono text-xs">{agent.tmux_window}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Created</p>
                <p className="text-xs">{new Date(agent.created_at).toLocaleString()}</p>
              </div>
            </div>

            {agent.current_task && (
              <>
                <Separator className="my-3" />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Current Task</p>
                  <p className="text-sm">{agent.current_task}</p>
                </div>
              </>
            )}

            <Separator className="my-3" />

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => interruptMutation.mutate()}
                disabled={interruptMutation.isPending}
                className="text-xs"
              >
                {interruptMutation.isPending ? '...' : '⚡ Interrupt'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => compactMutation.mutate()}
                disabled={compactMutation.isPending}
                className="text-xs"
              >
                {compactMutation.isPending ? '...' : '📦 Compact'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Tab Switcher */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg">
          <Button
            variant={activeTab === 'terminal' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('terminal')}
            className="flex-1 text-xs"
          >
            🖥️ Terminal
          </Button>
          <Button
            variant={activeTab === 'events' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('events')}
            className="flex-1 text-xs"
          >
            📋 Events
          </Button>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'terminal' ? (
          <TerminalView agentId={agent.id} maxHeight="400px" />
        ) : (
          <OutputPanel agentId={agent.id} maxHeight="400px" />
        )}
      </div>
    </ScrollArea>
  );
}
