import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getToolSummary } from '@/lib/toolSummary';
import {
  ChevronRight,
  Zap,
  Brain,
  Terminal,
} from 'lucide-react';
import { toolIcons } from '@/lib/tool-icons';
import type { Activity } from '@/types/activity';
import type { Thought } from '@/stores/thoughtStore';

interface InterleavedTimelineProps {
  thoughts: Thought[];
  toolCalls: Activity[];
}

/** A single step in the timeline: an optional thought paired with an optional tool call */
interface TimelineStep {
  thought?: Thought;
  tool?: Activity;
  timestamp: string;
}

const MAX_SHOWN = 30;

/**
 * Merge thoughts and tool calls into chronologically interleaved steps.
 * Pairs each reasoning thought with the next tool call when they're adjacent.
 */
function buildTimeline(thoughts: Thought[], toolCalls: Activity[]): TimelineStep[] {
  // Only use reasoning thoughts (ones with content)
  const reasoning = thoughts.filter(
    (t) => t.thought_type === 'reasoning' && t.content
  );

  type Tagged =
    | { kind: 'thought'; thought: Thought; ts: number }
    | { kind: 'tool'; tool: Activity; ts: number };

  const items: Tagged[] = [
    ...reasoning.map((t) => ({
      kind: 'thought' as const,
      thought: t,
      ts: new Date(t.timestamp).getTime(),
    })),
    ...toolCalls.map((tc) => ({
      kind: 'tool' as const,
      tool: tc,
      ts: new Date(tc.timestamp).getTime(),
    })),
  ];

  items.sort((a, b) => a.ts - b.ts);

  const steps: TimelineStep[] = [];
  let i = 0;

  while (i < items.length) {
    const curr = items[i];

    if (curr.kind === 'thought') {
      const next = items[i + 1];
      // Pair thought with the next tool call if it immediately follows
      if (next && next.kind === 'tool') {
        steps.push({
          thought: curr.thought,
          tool: next.tool,
          timestamp: curr.thought.timestamp,
        });
        i += 2;
      } else {
        // Standalone thought
        steps.push({
          thought: curr.thought,
          timestamp: curr.thought.timestamp,
        });
        i += 1;
      }
    } else {
      // Standalone tool call (no preceding thought)
      steps.push({
        tool: curr.tool,
        timestamp: curr.tool.timestamp,
      });
      i += 1;
    }
  }

  return steps;
}

/** "Read x5, Bash x2" */
function getStepCountSummary(toolCalls: Activity[]): string {
  const counts: Record<string, number> = {};
  for (const e of toolCalls) {
    const name = (e.data?.tool_name as string) || '?';
    counts[name] = (counts[name] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name}\u00a0\u00d7${count}`)
    .join(', ');
}

export function InterleavedTimeline({ thoughts, toolCalls }: InterleavedTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // P6.3 (performance audit): was recomputed unconditionally on every
  // render, including the toggle-only re-render from setIsExpanded above —
  // buildTimeline does array spreads + Date parsing + a full sort, none of
  // which depend on isExpanded.
  const steps = useMemo(() => buildTimeline(thoughts, toolCalls), [thoughts, toolCalls]);
  if (steps.length === 0) return null;

  const totalSteps = steps.length;
  const toolSummary = toolCalls.length > 0 ? getStepCountSummary(toolCalls) : '';

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'flex items-center gap-1.5 text-[11px] rounded-md px-2 py-0.5',
          'text-muted-foreground dark:text-muted-foreground/85 hover:text-muted-foreground hover:bg-muted/50 transition-colors',
        )}
      >
        <Zap className="h-3 w-3 text-yellow-700 dark:text-yellow-500" />
        <span>
          {totalSteps} step{totalSteps !== 1 ? 's' : ''}
        </span>
        {toolSummary && (
          <span className="text-muted-foreground dark:text-muted-foreground/80 truncate max-w-[200px]">
            {toolSummary}
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-3 w-3 transition-transform',
            isExpanded && 'rotate-90'
          )}
        />
      </button>

      {isExpanded && (
        <div className="mt-1 ml-1 pl-2 border-l-2 border-yellow-500/20 space-y-0 animate-in slide-in-from-top-1 duration-150">
          {steps.slice(0, MAX_SHOWN).map((step) => (
            <TimelineStepItem key={step.thought?.id ?? step.tool?.id ?? step.timestamp} step={step} />
          ))}
          {steps.length > MAX_SHOWN && (
            <p className="text-[10px] text-muted-foreground dark:text-muted-foreground/80 py-0.5">
              +{steps.length - MAX_SHOWN} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineStepItem({ step }: { step: TimelineStep }) {
  const toolName = step.tool
    ? ((step.tool.data?.tool_name as string) || 'Unknown')
    : null;
  const Icon = toolName ? (toolIcons[toolName] || Terminal) : null;

  return (
    <div className="py-0.5">
      {/* Thought reasoning (if present) */}
      {step.thought && (
        <p className="text-[11px] text-purple-700 dark:text-purple-400 italic truncate flex items-center gap-1">
          <Brain className="h-2.5 w-2.5 flex-shrink-0" />
          <span className="truncate">
            {truncateThought(step.thought.content || '')}
          </span>
        </p>
      )}
      {/* Tool call (if present) */}
      {step.tool && Icon && toolName && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground dark:text-muted-foreground/80">
          <Icon className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">
            {getToolSummary(toolName, step.tool.data?.tool_input)}
          </span>
        </div>
      )}
    </div>
  );
}

function truncateThought(content: string): string {
  const firstLine = content.split('\n')[0];
  if (firstLine.length > 100) return firstLine.slice(0, 100) + '\u2026';
  return firstLine;
}
