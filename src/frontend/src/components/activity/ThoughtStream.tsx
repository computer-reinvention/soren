import { useMemo } from 'react';
import { useThoughtStore, type Thought } from '@/stores/thoughtStore';
import { useAgentStore } from '@/stores/agentStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Brain } from 'lucide-react';

function ThoughtItem({ thought }: { thought: Thought }) {
  const time = new Date(thought.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="flex gap-2 text-xs py-1.5 px-2 rounded hover:bg-muted/50">
      <Brain className="h-3 w-3 mt-0.5 shrink-0 text-violet-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-medium text-violet-400">{thought.agent_name}</span>
          {thought.tool_name && (
            <span className="font-mono text-muted-foreground/60">before {thought.tool_name}</span>
          )}
          <span className="text-muted-foreground/50 ml-auto">{time}</span>
        </div>
        <p className="text-muted-foreground break-words whitespace-pre-wrap leading-relaxed">
          {thought.content}
        </p>
      </div>
    </div>
  );
}

export function ThoughtStream() {
  const thoughts = useThoughtStore((s) => s.thoughts);
  const { selectedAgentId, agents } = useAgentStore();
  // Only show reasoning entries with actual content (agent's thinking text).
  // tool_result entries and empty reasoning entries are tool call data — they belong in Events.
  // When an agent is selected, filter thoughts to that agent only.
  const reasoningThoughts = useMemo(() => {
    let filtered = thoughts.filter((t) => t.thought_type === 'reasoning' && t.content);
    if (selectedAgentId) {
      const agent = agents.find((a) => a.id === selectedAgentId);
      const agentName = agent?.name || agent?.display_name || selectedAgentId;
      filtered = filtered.filter(
        (t) =>
          t.agent_name === selectedAgentId ||
          t.agent_name === agentName ||
          t.agent_name.toLowerCase() === agentName.toLowerCase()
      );
    }
    return [...filtered].reverse();
  }, [thoughts, selectedAgentId, agents]);

  if (reasoningThoughts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <div className="text-center">
          <Brain className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">
            Agent reasoning will stream here as they think.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {reasoningThoughts.map((thought) => (
          <ThoughtItem key={thought.id} thought={thought} />
        ))}
      </div>
    </ScrollArea>
  );
}
