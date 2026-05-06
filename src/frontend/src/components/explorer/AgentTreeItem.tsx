import { cn, getAgentBadgeLabel, getAgentBadgeColor, formatTokenCount } from '@/lib/utils';
import { Bot, Crown, Loader2, ShieldCheck, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAgentEventStore } from '@/stores/agentEventStore';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Agent, AgentStatus } from '@/types/agent';

interface AgentTreeItemProps {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
  totalTokens?: number;
}

const statusColors: Record<AgentStatus, string> = {
  PENDING: 'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  BLOCKED: 'bg-red-500',
  TESTING: 'bg-yellow-500',
  COMPLETE: 'bg-green-500',
  FAILED: 'bg-red-600',
  IDLE: 'bg-gray-500',
  SLEEPING: 'bg-indigo-400',
};

export function AgentTreeItem({ agent, isSelected, onClick, totalTokens }: AgentTreeItemProps) {
  const queryClient = useQueryClient();
  const isSleeping = agent.status === 'SLEEPING';
  const handleWake = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await api.wakeAgent(agent.id).catch(() => {});
    queryClient.invalidateQueries({ queryKey: ['agents'] });
  };

  const isSupervisor = agent.type === 'supervisor' || agent.role === 'project-supervisor';
  const isProjectSupervisor = agent.role === 'project-supervisor';

  // Check if this agent is actively working by matching event agent_id
  // (SOREN_AGENT_NAME set by orchestrator) against agent identifiers
  const { latestEventBySession, isAgentActive } = useAgentEventStore();
  const isWorking = Object.entries(latestEventBySession).some(([sessionId, event]) => {
    const eventAgentId = (event.agent_id || '').toLowerCase();
    const matchesAgent =
      eventAgentId === agent.id.toLowerCase() ||
      eventAgentId === agent.name.toLowerCase() ||
      (agent.display_name && eventAgentId === agent.display_name.toLowerCase());
    return matchesAgent && isAgentActive(sessionId);
  }) || agent.status === 'IN_PROGRESS';

  // Clone detection
  const isClone = !!agent.clone_of;

  // Use display_name if available, fall back to name
  const displayName = agent.display_name || agent.name;

  // For clones, parse "ParentName | task summary" from display_name
  const cloneParts = isClone && displayName.includes('|')
    ? { parent: displayName.split('|')[0].trim(), task: displayName.split('|').slice(1).join('|').trim() }
    : null;

  const isPermanent = agent.permanent === true;
  const badgeLabel = getAgentBadgeLabel(agent);

  // Anomaly detection: stale worker and idle-too-long
  const minutesSinceActivity = agent.last_activity
    ? (Date.now() - new Date(agent.last_activity).getTime()) / 60_000
    : null;
  const isStale = !isWorking
    && minutesSinceActivity !== null
    && minutesSinceActivity > 30
    && agent.status !== 'IDLE'
    && agent.status !== 'COMPLETE';
  const idleHours = isPermanent && agent.status === 'IDLE' && minutesSinceActivity !== null && minutesSinceActivity > 60
    ? Math.floor(minutesSinceActivity / 60)
    : null;

  // Tooltip content: technical name + role type
  const tooltipText = isClone
    ? `${agent.name} · Clone of ${agent.clone_of}`
    : isPermanent
      ? `${agent.name} · Permanent Worker`
      : isSupervisor
        ? `${agent.name} · Supervisor`
        : agent.name;

  const button = (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors text-left',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        isSelected && 'bg-sidebar-accent text-sidebar-accent-foreground',
        isClone && 'pl-6',
        isSleeping && 'opacity-50'
      )}
    >
      {/* Status indicator with working animation */}
      <span
        className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          statusColors[agent.status],
          isWorking && 'animate-pulse ring-2 ring-green-400/50',
          isStale && 'ring-2 ring-amber-400/60 bg-amber-400',
          isClone && 'opacity-50'
        )}
        title={isWorking ? 'Working...' : isStale ? `Stale — no activity for ${Math.floor(minutesSinceActivity!)}min` : agent.status}
      />

      {/* Icon */}
      {isSupervisor ? (
        <Crown className={cn(
          'h-4 w-4 flex-shrink-0',
          isProjectSupervisor ? 'text-purple-500' : 'text-amber-500'
        )} />
      ) : isPermanent ? (
        <ShieldCheck className="h-4 w-4 text-teal-500 flex-shrink-0" />
      ) : (
        <Bot className={cn('h-4 w-4 flex-shrink-0', isClone ? 'text-muted-foreground/60' : 'text-muted-foreground')} />
      )}

      {/* Name — clones show "ParentName | task summary" with split styling */}
      {cloneParts ? (
        <span className="truncate flex-1">
          <span className="font-medium">{cloneParts.parent}</span>
          <span className="text-muted-foreground font-normal"> | {cloneParts.task}</span>
        </span>
      ) : (
        <span className="truncate flex-1">
          {displayName}
          {agent.display_name && agent.display_name !== agent.name && (
            <span className="ml-1.5 text-[10px] text-muted-foreground/40">{agent.name}</span>
          )}
        </span>
      )}

      {/* Token usage indicator */}
      {totalTokens && totalTokens > 0 && (
        <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
          {formatTokenCount(totalTokens)}
        </span>
      )}

      {/* Stale warning */}
      {isStale && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium flex-shrink-0">
          STALE
        </span>
      )}

      {/* Idle duration for permanent workers */}
      {idleHours !== null && !isStale && (
        <span className="text-[10px] text-muted-foreground/50 flex-shrink-0">
          idle {idleHours}h
        </span>
      )}

      {/* Working indicator - animated spinner */}
      {isWorking && (
        <span title="Processing...">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-green-500 flex-shrink-0" />
        </span>
      )}

      {/* Wake button for sleeping agents */}
      {isSleeping && (
        <button
          onClick={handleWake}
          title="Wake agent"
          className="flex-shrink-0 text-indigo-400"
        >
          <Play className="h-3 w-3 fill-current" />
        </button>
      )}

      {/* Type badge */}
      {!isSleeping && (
        <Badge
          variant="outline"
          className={cn('text-[10px] h-4 px-1', getAgentBadgeColor(badgeLabel))}
        >
          {badgeLabel}
        </Badge>
      )}
    </button>
  );

  // Show display_name differs from agent.name — tooltip reveals technical identity
  if (agent.display_name && agent.display_name !== agent.name) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}
