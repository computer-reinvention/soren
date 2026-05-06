import { useState } from 'react';
import { cn } from '@/lib/utils';
import { getToolSummary } from '@/lib/toolSummary';
import {
  ChevronRight,
  Zap,
  FileText,
  FileEdit,
  Play,
  FolderSearch,
  Search,
  Globe,
  Terminal,
} from 'lucide-react';
import type { Activity } from '@/types/activity';

interface ToolCallGroupProps {
  events: Activity[];
}

const toolIcons: Record<string, typeof Terminal> = {
  Read: FileText,
  Write: FileEdit,
  Edit: FileEdit,
  Bash: Play,
  Glob: FolderSearch,
  Grep: Search,
  WebFetch: Globe,
  WebSearch: Globe,
};

/** "Read x5, Bash x2, Edit x1" */
function getToolCountSummary(events: Activity[]): string {
  const counts: Record<string, number> = {};
  for (const e of events) {
    const name = (e.data?.tool_name as string) || '?';
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}\u00a0\u00d7${count}`)
    .join(', ');
}

const MAX_SHOWN = 30;

export function ToolCallGroup({ events }: ToolCallGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (events.length === 0) return null;

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-1.5 text-[11px] rounded-md px-2 py-0.5',
          'text-muted-foreground/70 hover:text-muted-foreground hover:bg-muted/50 transition-colors',
        )}
      >
        <Zap className="h-3 w-3 text-yellow-500/70" />
        <span>{events.length} step{events.length !== 1 ? 's' : ''}</span>
        <span className="text-muted-foreground/40 truncate max-w-[200px]">
          {getToolCountSummary(events)}
        </span>
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1 pl-2 border-l-2 border-yellow-500/20 space-y-0 animate-in slide-in-from-top-1 duration-150">
          {events.slice(0, MAX_SHOWN).map((event) => (
            <ToolCallItem key={event.id} event={event} />
          ))}
          {events.length > MAX_SHOWN && (
            <p className="text-[10px] text-muted-foreground/40 py-0.5">
              +{events.length - MAX_SHOWN} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ToolCallItem({ event }: { event: Activity }) {
  const toolName = (event.data?.tool_name as string) || 'Unknown';
  const toolInput = event.data?.tool_input;
  const Icon = toolIcons[toolName] || Terminal;

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 py-0.5">
      <Icon className="h-3 w-3 flex-shrink-0" />
      <span className="truncate">
        {getToolSummary(toolName, toolInput)}
      </span>
    </div>
  );
}
