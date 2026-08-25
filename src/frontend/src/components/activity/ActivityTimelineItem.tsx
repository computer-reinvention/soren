import { useState, memo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Terminal,
  MessageSquare,
  ArrowRight,
  AlertCircle,
  Webhook,
  User,
  ChevronRight,
  Mail,
  Heart,
} from 'lucide-react';
import { toolIcons } from '@/lib/tool-icons';
import { formatDistanceToNow } from 'date-fns';
import { getToolSummary, getToolInputDetails, getToolOutputSummary } from '@/lib/toolSummary';
import type { Activity, ActivityType } from '@/types/activity';

interface ActivityTimelineItemProps {
  activity: Activity;
  isLast?: boolean;
  showProjectBadge?: boolean;
}

const typeConfig: Record<
  ActivityType,
  { icon: typeof Terminal; color: string; bgColor: string; label: string }
> = {
  tool_call: {
    icon: Terminal,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-500/10',
    label: 'Tool Call',
  },
  message_sent: {
    icon: ArrowRight,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-500/10',
    label: 'Sent',
  },
  message_received: {
    icon: MessageSquare,
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-500/10',
    label: 'Received',
  },
  status_change: {
    icon: AlertCircle,
    color: 'text-yellow-600 dark:text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    label: 'Status',
  },
  webhook_received: {
    icon: Webhook,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-500/10',
    label: 'Webhook',
  },
  user_message: {
    icon: User,
    color: 'text-pink-600 dark:text-pink-400',
    bgColor: 'bg-pink-500/10',
    label: 'User',
  },
  mailbox_message: {
    icon: Mail,
    color: 'text-cyan-600 dark:text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    label: 'Mailbox',
  },
  heartbeat: {
    icon: Heart,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-500/10',
    label: 'Heartbeat',
  },
};

const LOW_SIGNAL_TYPES: ReadonlySet<ActivityType> = new Set(['heartbeat', 'status_change']);

// P6.3 (performance audit): memoized — mapped over every visible activity,
// and activityStore's own updates always prepend-and-slice into a new
// array without mutating existing items, so unchanged `activity` objects
// keep the same reference across re-renders (this memo has something to
// actually bail out on).
export const ActivityTimelineItem = memo(function ActivityTimelineItem({ activity, isLast, showProjectBadge }: ActivityTimelineItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const config = typeConfig[activity.type];
  const time = formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true });
  const hasDetails = activity.data && Object.keys(activity.data).length > 0;
  const isLowSignal = LOW_SIGNAL_TYPES.has(activity.type);

  // For tool calls, use a tool-specific icon
  const toolName = activity.data?.tool_name as string | undefined;
  const ToolIcon = (activity.type === 'tool_call' && toolName)
    ? (toolIcons[toolName] || Terminal)
    : config.icon;

  return (
    <div className={cn("relative pl-6", isLowSignal && "opacity-50")}>
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[11px] top-6 bottom-0 w-px bg-border" />
      )}

      {/* Timeline dot */}
      <div
        className={cn(
          'absolute left-0 top-1 h-6 w-6 rounded-full flex items-center justify-center',
          config.bgColor
        )}
      >
        <ToolIcon className={cn('h-3 w-3', config.color)} />
      </div>

      {/* Content */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild disabled={!hasDetails}>
          <button
            className={cn(
              'w-full text-left rounded-lg border bg-card p-2.5 compact:p-1.5 transition-colors',
              hasDetails && 'hover:bg-accent cursor-pointer',
              !hasDetails && 'cursor-default'
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {activity.agent_id}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className={cn('text-[10px] h-4 px-1', config.color)}
                  >
                    {activity.type === 'tool_call' && toolName ? toolName : config.label}
                  </Badge>
                  {showProjectBadge && (activity.data?.session as string) && (
                    <Badge
                      variant="outline"
                      className="text-[10px] h-4 px-1 border-indigo-500/50 text-indigo-500"
                    >
                      {(activity.data.session as string).replace('soren-', '')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {getActivitySummary(activity)}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {time}
                </span>
                {hasDetails && (
                  <ChevronRight
                    className={cn(
                      'h-3 w-3 text-muted-foreground transition-transform',
                      isOpen && 'rotate-90'
                    )}
                  />
                )}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        {hasDetails && (
          <CollapsibleContent>
            <div className="mt-1 ml-2 rounded bg-muted/50 text-xs overflow-hidden">
              {activity.type === 'tool_call' && toolName ? (
                <ToolCallDetails
                  toolName={toolName}
                  toolInput={activity.data?.tool_input}
                  toolOutput={activity.data?.tool_output}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-muted-foreground font-mono overflow-x-auto p-2">
                  {JSON.stringify(activity.data, null, 2)}
                </pre>
              )}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
});

/** Structured view for tool call details instead of raw JSON */
function ToolCallDetails({
  toolName,
  toolInput,
  toolOutput,
}: {
  toolName: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}) {
  const [showOutput, setShowOutput] = useState(false);
  const inputDetails = getToolInputDetails(toolName, toolInput);
  const outputSummary = getToolOutputSummary(toolOutput);

  return (
    <div className="divide-y divide-border/50">
      {/* Input details */}
      {inputDetails.length > 0 && (
        <div className="p-2 space-y-1">
          {inputDetails.map((detail, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground dark:text-muted-foreground/85 flex-shrink-0 w-16 text-right">
                {detail.label}:
              </span>
              <span className="text-foreground/80 font-mono break-all">
                {detail.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Output (collapsed by default) */}
      {outputSummary && (
        <div>
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="w-full px-2 py-1 text-left text-muted-foreground dark:text-muted-foreground/85 hover:text-muted-foreground hover:bg-muted/30 transition-colors flex items-center gap-1"
          >
            <ChevronRight className={cn('h-3 w-3 transition-transform', showOutput && 'rotate-90')} />
            Output
          </button>
          {showOutput && (
            <pre className="px-2 pb-2 whitespace-pre-wrap text-muted-foreground font-mono overflow-x-auto max-h-48 overflow-y-auto">
              {outputSummary}
            </pre>
          )}
        </div>
      )}

      {/* Fallback if no structured details */}
      {inputDetails.length === 0 && !outputSummary && (
        <pre className="p-2 whitespace-pre-wrap text-muted-foreground font-mono overflow-x-auto">
          {JSON.stringify({ tool_input: toolInput, tool_output: toolOutput }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function getActivitySummary(activity: Activity): string {
  switch (activity.type) {
    case 'tool_call': {
      const toolName = activity.data?.tool_name as string | undefined;
      const toolInput = activity.data?.tool_input;
      if (toolName) return getToolSummary(toolName, toolInput);
      return 'Tool executed';
    }
    case 'user_message':
      return String(activity.data?.content || 'Message sent').slice(0, 100);
    case 'message_sent':
      return String(activity.data?.content || 'Message').slice(0, 100);
    case 'mailbox_message': {
      const from = activity.data?.from_agent || 'unknown';
      const to = activity.data?.to_agent || 'unknown';
      const content = String(activity.data?.content || '').slice(0, 60);
      return `${from} \u2192 ${to}: ${content}`;
    }
    case 'webhook_received':
      return `From: ${activity.data?.source || 'external'}`;
    case 'status_change':
      return `Status: ${activity.data?.status || 'changed'}`;
    case 'heartbeat': {
      if (activity.data?.highest_priority) return String(activity.data.highest_priority);
      const sections = activity.data?.sections as Record<string, string> | undefined;
      if (sections) {
        const keys = Object.keys(sections).filter((k) => sections[k]);
        if (keys.length > 0) return keys.join(', ');
      }
      return 'System alert';
    }
    default:
      return activity.type;
  }
}
