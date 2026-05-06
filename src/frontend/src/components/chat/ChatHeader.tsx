import { formatDistanceToNow, format } from 'date-fns';
import { useConnectionStore } from '@/stores/connectionStore';
import { useAgentEventStore } from '@/stores/agentEventStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Wifi,
  WifiOff,
  MoreVertical,
  Trash2,
  StopCircle,
  RefreshCw,
  MessagesSquare,
  MessageSquare,
  GitBranch,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentStore } from '@/stores/agentStore';
import { useMessages } from '@/hooks/useMessages';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import type { Agent } from '@/types/agent';

interface ChatHeaderProps {
  agentId?: string | null;
  agent?: Agent | null;
  isWorker?: boolean;
  onClearChat?: () => void;
  showAllMessages?: boolean;
  onToggleFilter?: () => void;
}

// Map agent status to display style
function getStatusDisplay(status: string | undefined, isActive: boolean) {
  if (isActive) {
    return {
      label: 'WORKING',
      className: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    };
  }

  switch (status) {
    case 'IDLE':
      return {
        label: 'IDLE',
        className: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
      };
    case 'IN_PROGRESS':
      return {
        label: 'WORKING',
        className: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
      };
    case 'PENDING':
      return {
        label: 'PENDING',
        className: 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30',
      };
    case 'BLOCKED':
      return {
        label: 'BLOCKED',
        className: 'bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30',
      };
    case 'FAILED':
      return {
        label: 'FAILED',
        className: 'bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30',
      };
    case 'COMPLETE':
      return {
        label: 'COMPLETE',
        className: 'bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30',
      };
    default:
      return {
        label: status || 'UNKNOWN',
        className: 'bg-muted text-muted-foreground',
      };
  }
}

export function ChatHeader({
  agentId,
  agent,
  isWorker,
  onClearChat,
  showAllMessages,
  onToggleFilter,
}: ChatHeaderProps) {
  const { isConnected, isReconnecting } = useConnectionStore();
  const { getActiveSessions, latestEventBySession } = useAgentEventStore();
  const agents = useAgentStore((state) => state.agents);
  const { total: totalMessagesCount } = useMessages();
  const { data: healthData } = useHealthCheck();
  const isHealthDegraded = healthData?.status === 'degraded';

  const isCommandCenter = !agentId;

  // Check if the current agent is active
  const activeSessions = getActiveSessions();
  const isAgentActive = agentId
    ? activeSessions.some(
        (sessionId) =>
          sessionId.toLowerCase().includes(agentId.toLowerCase()) ||
          latestEventBySession[sessionId]?.agent_id === agentId
      )
    : activeSessions.length > 0;

  const statusDisplay = getStatusDisplay(agent?.status, isAgentActive);

  // Get last activity time
  const lastActivity = agent?.last_activity;
  const lastActivityDate = lastActivity ? new Date(lastActivity) : null;
  const relativeActivity = lastActivityDate
    ? formatDistanceToNow(lastActivityDate, { addSuffix: true })
    : null;
  const preciseActivity = lastActivityDate
    ? format(lastActivityDate, 'MMM d, yyyy h:mm:ss a')
    : null;

  // Command Center stats
  const workingCount = agents.filter((a) => a.status === 'IN_PROGRESS').length;
  const idleCount = agents.filter((a) => a.status === 'IDLE').length;
  const blockedCount = agents.filter((a) => a.status === 'BLOCKED').length;
  const totalMessages = totalMessagesCount;

  const displayName = agent?.display_name || agentId || 'supervisor';
  const title = agentId ? displayName : 'Command Center';
  const isPermanent = agent?.permanent === true;

  // Smart one-line summary for command center
  const summaryParts = [`${workingCount} working`, `${idleCount} idle`];
  if (blockedCount > 0) summaryParts.push(`${blockedCount} blocked`);
  summaryParts.push(`${totalMessages} messages`);

  const subtitle = agentId
    ? `${isPermanent ? 'Permanent Worker' : isWorker ? 'Worker' : 'Supervisor'} agent`
    : summaryParts.join(' · ');

  return (
    <div className="px-4 pt-4 pb-2 border-b flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold truncate">
            {title}
            {agentId && agent?.display_name && agent.display_name !== agent.name && (
              <span className="ml-2 text-xs font-normal text-muted-foreground/40">{agent.name}</span>
            )}
          </h2>
          {isCommandCenter ? (
            <>
              {workingCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500/30"
                >
                  {workingCount} working
                </Badge>
              )}
              {blockedCount > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 bg-orange-500/20 text-orange-600 dark:text-orange-400 border-orange-500/30"
                >
                  {blockedCount} blocked
                </Badge>
              )}
              <Badge
                variant="outline"
                className="text-[10px] h-5 px-1.5 bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30"
              >
                {idleCount} idle
              </Badge>
            </>
          ) : (
            <>
              <Badge
                variant="outline"
                className={cn('text-[10px] h-5 px-1.5', statusDisplay.className)}
              >
                {statusDisplay.label}
              </Badge>
              {isPermanent && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 bg-teal-500/20 text-teal-600 dark:text-teal-400 border-teal-500/30"
                >
                  Permanent
                </Badge>
              )}
              {agent?.worktree_branch && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-5 px-1.5 font-mono bg-violet-500/10 text-violet-500 border-violet-500/30"
                >
                  <GitBranch className="h-3 w-3 mr-0.5" />
                  {agent.worktree_branch}
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{subtitle}</span>
          {isPermanent && (agent?.reset_count || agent?.tasks_since_reset) ? (
            <>
              <span className="text-muted-foreground/50">|</span>
              <span>
                {agent.reset_count ? `${agent.reset_count} resets` : ''}
                {agent.reset_count && agent.tasks_since_reset ? ', ' : ''}
                {agent.tasks_since_reset ? `${agent.tasks_since_reset} tasks` : ''}
              </span>
            </>
          ) : null}
          {lastActivityDate && (
            <>
              <span className="text-muted-foreground/50">|</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-default">
                    Active {relativeActivity}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {preciseActivity}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Right side - connection status and actions */}
      <div className="flex items-center gap-2">
        {/* Message filter toggle - only show when viewing a specific agent */}
        {agentId && onToggleFilter && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  showAllMessages && 'bg-accent'
                )}
                onClick={onToggleFilter}
              >
                {showAllMessages ? (
                  <MessagesSquare className="h-4 w-4" />
                ) : (
                  <MessageSquare className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {showAllMessages ? 'Showing all messages' : 'Showing user messages only'}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Health degraded indicator */}
        {isHealthDegraded && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                <span className="hidden sm:inline">Degraded</span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              System health degraded — {healthData?.frontend?.status === 'unhealthy' ? 'frontend build missing' : 'check server'}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Connection indicator */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs',
                isConnected
                  ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                  : isReconnecting
                    ? 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                    : 'bg-red-500/10 text-red-600 dark:text-red-400'
              )}
            >
              {isConnected ? (
                <Wifi className="h-3 w-3" />
              ) : isReconnecting ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <WifiOff className="h-3 w-3" />
              )}
              <span className="hidden sm:inline">
                {isConnected
                  ? 'Connected'
                  : isReconnecting
                    ? 'Reconnecting'
                    : 'Disconnected'}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            WebSocket {isConnected ? 'connected' : 'disconnected'}
          </TooltipContent>
        </Tooltip>

        {/* Actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onClearChat && (
              <DropdownMenuItem onClick={onClearChat}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear chat
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled
              className="text-muted-foreground"
            >
              <StopCircle className="h-4 w-4 mr-2" />
              Interrupt agent
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
