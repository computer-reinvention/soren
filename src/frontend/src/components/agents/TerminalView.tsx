import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

interface TerminalViewProps {
  agentId: string;
  maxHeight?: string;
}

export function TerminalView({ agentId, maxHeight = '300px' }: TerminalViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agent-terminal', agentId],
    queryFn: () => api.getAgentTerminal(agentId, 80),
  });

  // Auto-scroll to bottom on new data
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.output]);

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader className="py-2 px-3 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm text-zinc-400 font-mono flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Terminal
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="h-6 text-xs text-zinc-500 hover:text-zinc-300"
          >
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea style={{ maxHeight }} ref={scrollRef}>
          <div className="p-3">
            {isLoading && !data ? (
              <p className="text-zinc-500 text-sm font-mono">Loading...</p>
            ) : (
              <pre className="text-xs font-mono text-green-400 whitespace-pre-wrap break-all leading-relaxed">
                {data?.output || 'No output'}
              </pre>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
