import { useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { useAgentOutput } from '@/hooks/useAgentOutput';
import type { AgentEvent } from '@/types/agent_event';

interface OutputPanelProps {
  agentId: string;
  sessionId?: string;
  maxHeight?: string;
}

const toolColors: Record<string, string> = {
  Bash: 'bg-green-600',
  Write: 'bg-blue-600',
  Edit: 'bg-yellow-600',
  Read: 'bg-purple-600',
  default: 'bg-gray-600',
};

export function OutputPanel({
  agentId,
  sessionId,
  maxHeight = '400px',
}: OutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { events, isLoading, hasEvents } = useAgentOutput({
    agentId,
    sessionId,
  });

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [events.length]);

  if (isLoading && !hasEvents) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Output</CardTitle>
        </CardHeader>
        <CardContent className="py-3">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Agent Output</span>
          {hasEvents && (
            <Badge variant="outline" className="text-xs">
              {events.length} events
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ maxHeight }} ref={scrollRef}>
          {!hasEvents ? (
            <p className="p-4 text-sm text-muted-foreground">
              No output yet. Events will appear here when the agent runs tools.
            </p>
          ) : (
            <div className="divide-y">
              {events.map((event) => (
                <OutputEventItem key={event.id} event={event} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function OutputEventItem({ event }: { event: AgentEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const toolColor = event.tool_name
    ? toolColors[event.tool_name] || toolColors.default
    : toolColors.default;

  // For Stop events
  if (event.event_type === 'Stop') {
    return (
      <div className="p-3 bg-muted/30">
        <div className="flex items-center justify-between mb-1">
          <Badge variant="outline" className="text-xs">
            Response Complete
          </Badge>
          <span className="text-xs text-muted-foreground">{time}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {event.tool_name && (
            <Badge className={`text-xs ${toolColor}`}>{event.tool_name}</Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{time}</span>
      </div>

      {/* Tool Input */}
      {event.tool_input !== undefined && event.tool_input !== null && (
        <div className="mb-2">
          <p className="text-xs text-muted-foreground mb-1">Input:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-24 overflow-y-auto">
            {String(formatContent(event.tool_input))}
          </pre>
        </div>
      )}

      {/* Tool Output */}
      {event.tool_output !== undefined && event.tool_output !== null && (
        <div>
          <p className="text-xs text-muted-foreground mb-1">Output:</p>
          <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto font-mono">
            {String(formatContent(event.tool_output))}
          </pre>
        </div>
      )}
    </div>
  );
}

function formatContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (content === null || content === undefined) {
    return '';
  }
  // For objects, try to extract common fields
  if (typeof content === 'object') {
    const obj = content as Record<string, unknown>;
    // If it's a tool response with output field
    if ('output' in obj && typeof obj.output === 'string') {
      return obj.output;
    }
    // If it's a command input
    if ('command' in obj && typeof obj.command === 'string') {
      return `$ ${obj.command}`;
    }
    // Otherwise stringify
    return JSON.stringify(content, null, 2);
  }
  return String(content);
}
