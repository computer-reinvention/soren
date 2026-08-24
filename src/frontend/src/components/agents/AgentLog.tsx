import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useActivityStore } from '@/stores/activityStore';
import { getToolIcon } from '@/lib/tool-icons';
import { api } from '@/lib/api';
import { ArrowDown, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Activity } from '@/types/activity';

interface AgentLogProps {
  agentId: string;
}

const MAX_INLINE_CHARS = 4000;

function matchesAgent(activityAgentId: string, agentId: string): boolean {
  const a = activityAgentId.toLowerCase();
  const b = agentId.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Strip ANSI color/cursor codes — tool output (e.g. bash) often carries
 * them, and this is a raw text log, not a terminal emulator (full ANSI
 * color reconstruction is a separate feature, cf. archived-view audit). */
function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE, '');
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return stripAnsi(v);
  try {
    return stripAnsi(JSON.stringify(v, null, 2));
  } catch {
    return stripAnsi(String(v));
  }
}

function LogEntry({ activity }: { activity: Activity }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = (activity.data.tool_name as string | undefined) ?? 'event';
  const Icon = getToolIcon(toolName);
  const input = formatValue(activity.data.tool_input);
  const output = formatValue(activity.data.tool_output);
  const time = new Date(activity.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const combined = input + output;
  const isLong = combined.length > MAX_INLINE_CHARS;
  const shown = expanded || !isLong;

  return (
    <div className="border-b border-border/30 px-3 py-1.5 font-mono text-[11px] leading-relaxed">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="w-16 shrink-0 tabular-nums">{time}</span>
        <Icon className="h-3 w-3 shrink-0 text-primary" aria-hidden />
        <span className="font-semibold text-foreground/90">{toolName}</span>
      </div>
      {(input || output) && (
        <div className="mt-0.5 space-y-1 pl-[4.75rem]">
          {input && (
            <pre className="whitespace-pre-wrap break-all text-emerald-500/90">
              {shown ? input : input.slice(0, MAX_INLINE_CHARS) + '…'}
            </pre>
          )}
          {output && (
            <pre className="whitespace-pre-wrap break-all text-muted-foreground/80">
              {shown ? output : output.slice(0, MAX_INLINE_CHARS) + '…'}
            </pre>
          )}
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] text-primary hover:underline"
            >
              {expanded ? 'collapse' : `show all (${combined.length.toLocaleString()} chars)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Continuous, auto-scrolling log of an agent's tool calls with full
 * input/output — "tail -f" for agent activity (P3.4). Distinct from the
 * chat view's InterleavedTimeline (collapsed, correlated to messages):
 * this is raw and chronological, uncorrelated, always following the
 * live tail unless the user has scrolled up to read history.
 */
export function AgentLog({ agentId }: AgentLogProps) {
  const liveActivities = useActivityStore((s) => s.activities);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  // Seed with persisted history for this agent beyond the global 100-event
  // cache useAgentEvents() loads at app start (that cache is shared/capped
  // across all agents; a busy agent can easily fall out of it).
  const { data: historyData } = useQuery({
    queryKey: ['agent-events', agentId],
    queryFn: () => api.getAgentEvents(undefined, 200),
    staleTime: 30_000,
  });

  const entries = useMemo(() => {
    const historical: Activity[] = (historyData?.events ?? [])
      .filter((e) => e.agent_id && matchesAgent(e.agent_id, agentId))
      .map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        type: 'tool_call' as const,
        agent_id: e.agent_id || '',
        data: { tool_name: e.tool_name, tool_input: e.tool_input, tool_output: e.tool_output },
      }));
    const live = liveActivities.filter(
      (a) => a.type === 'tool_call' && matchesAgent(a.agent_id, agentId)
    );
    const byId = new Map<string, Activity>();
    for (const a of [...historical, ...live]) byId.set(a.id, a);
    return [...byId.values()].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [historyData, liveActivities, agentId]);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
    setUnreadCount(0);
  };

  const handleScroll = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const near = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 80;
    setIsNearBottom(near);
    if (near) setUnreadCount(0);
  };

  const prevCount = useRef(entries.length);
  useEffect(() => {
    const added = entries.length - prevCount.current;
    if (added > 0) {
      if (isNearBottom) requestAnimationFrame(() => scrollToBottom(false));
      else setUnreadCount((c) => c + added);
    }
    prevCount.current = entries.length;
  }, [entries.length, isNearBottom]);

  useEffect(() => {
    requestAnimationFrame(() => scrollToBottom(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <ListTree className="mr-2 h-5 w-5 opacity-40" aria-hidden />
        no tool activity yet
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden">
      <ScrollArea className="h-full" viewportRef={viewportRef} onScroll={handleScroll}>
        <div className="pb-2">
          {entries.map((a) => (
            <LogEntry key={a.id} activity={a} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      {unreadCount > 0 && !isNearBottom && (
        <div className="absolute bottom-3 right-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => scrollToBottom(true)}
            className="h-7 gap-1.5 rounded-full text-[11px] shadow-lg"
          >
            <ArrowDown className="h-3 w-3" aria-hidden />
            {unreadCount} new
          </Button>
        </div>
      )}
    </div>
  );
}
