import { useState } from 'react';
import { cn, getAgentBadgeLabel, getAgentBadgeColor, parseMessagePrefix } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Link } from 'react-router-dom';
import { MarkdownContent } from './MarkdownContent';
import { MessageActions } from './MessageActions';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { routes } from '@/lib/navigation';
import { ChevronDown, ChevronUp, HeartPulse, ShieldAlert, Radio, ImageIcon } from 'lucide-react';
import { format } from 'date-fns';
import { InterleavedTimeline } from './InterleavedTimeline';
import { API_BASE } from '@/lib/constants';
import type { Message } from '@/types/message';
import type { Activity } from '@/types/activity';
import type { Thought } from '@/stores/thoughtStore';

// Fixed-prefix patterns for incoming system messages (heartbeat pings, sentry briefings)
const SYSTEM_CONTENT_PREFIXES = [
  { prefix: 'SENTRY BRIEFING', label: 'Sentry Recovery', icon: 'shield' as const },
  { prefix: 'SYSTEM ALERT', label: 'System Alert', icon: 'shield' as const },
  { prefix: '[HEARTBEAT]', label: 'Heartbeat', icon: 'heartbeat' as const },
  { prefix: '[SYSTEM AUTO-JOURNAL', label: 'Journal Reminder', icon: 'radio' as const },
] as const;

const SYSTEM_AGENTS = new Set(['health', 'monitor', 'system']);

type SystemIcon = 'heartbeat' | 'shield' | 'radio';

export function getSystemNotificationInfo(message: Message): { label: string; icon: SystemIcon; summary: string } | null {
  const content = message.content.trim();

  // Primary: check message.type === 'system' (set by backend when agent prefixes with [SYS])
  if (message.type === 'system') {
    return { label: 'System', icon: 'radio', summary: getFirstSentence(content) };
  }

  // Check from_agent for system sources
  if (SYSTEM_AGENTS.has(message.from_agent)) {
    if (content.includes('rollback') || content.includes('SYSTEM ALERT')) {
      return { label: 'System Alert', icon: 'shield', summary: getFirstSentence(content) };
    }
    return { label: 'System Message', icon: 'radio', summary: getFirstSentence(content) };
  }

  // Fallback: check fixed content prefixes for legacy/incoming system messages
  for (const { prefix, label, icon } of SYSTEM_CONTENT_PREFIXES) {
    if (content.startsWith(prefix)) {
      return { label, icon, summary: getFirstSentence(content) };
    }
  }

  return null;
}

function getFirstSentence(content: string): string {
  const cleaned = content.replace(/^(SENTRY BRIEFING:|SYSTEM ALERT:|---\s*MESSAGE\s*---[\s\S]*?---\s*)/i, '').trim();
  const firstLine = cleaned.split(/[.\n]/)[0]?.trim() || cleaned;
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
}

const SystemIconComponent = ({ icon }: { icon: SystemIcon }) => {
  switch (icon) {
    case 'heartbeat': return <HeartPulse className="h-3 w-3" />;
    case 'shield': return <ShieldAlert className="h-3 w-3" />;
    case 'radio': return <Radio className="h-3 w-3" />;
  }
};

interface ChatMessageProps {
  message: Message;
  toolCalls?: Activity[];
  thoughts?: Thought[];
  collapseCount?: number;
  /** When set, flips alignment: messages FROM this agent align left, others right. */
  inboxAgentId?: string;
}

const PREVIEW_LENGTH = 1200;
const COLLAPSE_THRESHOLD = PREVIEW_LENGTH + 200;

// Get preview content, trying to not break markdown
function getPreviewContent(content: string): string {
  const firstCodeBlockMatch = content.match(/```[\s\S]*?```/);
  if (firstCodeBlockMatch && firstCodeBlockMatch.index !== undefined) {
    const codeBlockEnd = firstCodeBlockMatch.index + firstCodeBlockMatch[0].length;
    if (codeBlockEnd <= PREVIEW_LENGTH * 2) {
      return content.slice(0, codeBlockEnd);
    }
  }

  let truncated = content.slice(0, PREVIEW_LENGTH);
  const lastNewline = truncated.lastIndexOf('\n\n');
  const lastPeriod = truncated.lastIndexOf('. ');

  if (lastNewline > PREVIEW_LENGTH * 0.5) {
    truncated = truncated.slice(0, lastNewline);
  } else if (lastPeriod > PREVIEW_LENGTH * 0.5) {
    truncated = truncated.slice(0, lastPeriod + 1);
  }

  return truncated;
}

function SystemNotification({ message, info, collapseCount }: { message: Message; info: { label: string; icon: SystemIcon; summary: string }; collapseCount?: number }) {
  const [expanded, setExpanded] = useState(false);
  const messageDate = new Date(message.timestamp);
  const preciseTime = format(messageDate, 'HH:mm:ss');

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 py-0.5 max-w-full">
        <div className="flex-1 h-px bg-border/30" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-2xs text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted/30 shrink-0 font-mono"
        >
          <span className="opacity-50">{preciseTime}</span>
          <SystemIconComponent icon={info.icon} />
          <span className="font-medium">{info.label}</span>
          {collapseCount && collapseCount > 1 && (
            <span className="text-muted-foreground/50 text-2xs">
              x{collapseCount}
            </span>
          )}
          {!expanded && (
            <span className="max-w-[200px] truncate opacity-40">
              {info.summary}
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-2.5 w-2.5 opacity-40" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5 opacity-40" />
          )}
        </button>
        <div className="flex-1 h-px bg-border/30" />
      </div>
      {expanded && (
        <div className="ml-[70px] bg-muted/20 border border-border/30 rounded px-3 py-2 text-xs text-muted-foreground">
          <MarkdownContent content={message.content} className="text-xs [&_p]:mb-1 [&_p]:last:mb-0" />
        </div>
      )}
    </div>
  );
}

/** Log-style message for agent messages */
function LogMessage({ message, toolCalls, thoughts, collapseCount, isUser, isCurrentUser, displayName, agentData, prefixInfo, photoMatch, photoFilePath, isPhoto }: {
  message: Message;
  toolCalls?: Activity[];
  thoughts?: Thought[];
  collapseCount?: number;
  isUser: boolean;
  isCurrentUser: boolean;
  displayName: string;
  agentData: Parameters<typeof getAgentBadgeLabel>[0] & { name: string; display_name?: string } | null | undefined;
  prefixInfo: ReturnType<typeof parseMessagePrefix>;
  photoMatch: RegExpMatchArray | null;
  photoFilePath: string | null;
  isPhoto: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  let rawContent = message.content;
  if (photoMatch) rawContent = rawContent.trimStart().slice(photoMatch[0].length);
  if (message.type === 'mailbox' && rawContent.includes(' | ')) {
    const pipeIdx = rawContent.indexOf(' | ');
    let bodyPart = rawContent.slice(pipeIdx + 3).trimStart();
    const bodyPhoto = bodyPart.match(/^\[photo(?::([^\]]+))?\]\s*/);
    if (bodyPhoto) bodyPart = bodyPart.slice(bodyPhoto[0].length);
    if (bodyPart.length > 0) rawContent = bodyPart;
  }

  const messageContent = prefixInfo ? prefixInfo.rest : rawContent;
  const previewContent = getPreviewContent(messageContent);
  const actuallyTruncated = previewContent.length < messageContent.length;
  const shouldCollapse = messageContent.length > COLLAPSE_THRESHOLD && actuallyTruncated && !isUser;
  const isCollapsed = shouldCollapse && !isExpanded;
  const displayContent = isCollapsed ? previewContent : messageContent;

  const messageDate = new Date(message.timestamp);
  const preciseTime = format(messageDate, 'HH:mm:ss');
  const showToIndicator = !isUser && !(message.from_agent === 'supervisor' && (message.to_agent === 'user'));

  return (
    <div className={cn('group relative flex gap-0 py-1 hover:bg-muted/20 transition-colors rounded-sm px-1 -mx-1')}>
      {/* Timestamp column - fixed width */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-2xs font-mono text-muted-foreground/50 w-[58px] flex-shrink-0 pt-0.5 select-none cursor-default">
            {preciseTime}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs font-mono">
          {format(messageDate, 'MMM d, yyyy HH:mm:ss')}
        </TooltipContent>
      </Tooltip>

      {/* Sender column */}
      <div className="flex-shrink-0 w-[120px] min-w-0 pt-0.5">
        <div className="flex items-center gap-1 truncate">
          {isCurrentUser ? (
            <span className="text-xs font-mono font-medium text-primary truncate">you</span>
          ) : isUser ? (
            <span className="text-xs font-mono font-medium text-foreground truncate">
              {displayName}
            </span>
          ) : (
            <Link
              to={routes.agent(message.from_agent)}
              className="text-xs font-mono font-medium text-foreground hover:text-primary truncate transition-colors cursor-pointer"
            >
              {displayName}
            </Link>
          )}
          {showToIndicator && (
            <span className="text-2xs text-muted-foreground/40 font-mono shrink-0">
              {'>'}{message.to_agent}
            </span>
          )}
        </div>
      </div>

      {/* Content column */}
      <div className="flex-1 min-w-0">
        {/* Badges row — only render when there is visible static content */}
        {((!isUser && agentData) || prefixInfo || (collapseCount && collapseCount > 1)) && (
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {!isUser && agentData && (() => {
              const label = getAgentBadgeLabel(agentData);
              return (
                <Badge
                  variant="outline"
                  className={cn('text-2xs h-4 px-1 font-mono', getAgentBadgeColor(label))}
                >
                  {label}
                </Badge>
              );
            })()}
            {prefixInfo && (
              <Badge
                variant="outline"
                className={cn('text-2xs h-4 px-1 font-mono font-semibold', prefixInfo.className)}
              >
                {prefixInfo.label}
              </Badge>
            )}
            {collapseCount && collapseCount > 1 && (
              <span className="text-2xs font-mono text-muted-foreground/50">
                x{collapseCount}
              </span>
            )}
            <MessageActions
              content={message.content}
              isUser={isCurrentUser}
              className="ml-auto"
            />
          </div>
        )}
        {/* Actions for user messages — absolutely positioned */}
        {!(!isUser && agentData) && !prefixInfo && !(collapseCount && collapseCount > 1) && (
          <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <MessageActions content={message.content} isUser={isCurrentUser} />
          </div>
        )}

        {/* Tool calls / thoughts timeline */}
        {!isUser && ((thoughts && thoughts.length > 0) || (toolCalls && toolCalls.length > 0)) && (
          <InterleavedTimeline
            thoughts={thoughts || []}
            toolCalls={toolCalls || []}
          />
        )}

        {/* Photo */}
        {isPhoto && photoFilePath && (
          <div className="mb-1.5">
            <a
              href={`${API_BASE}/api/filesystem/image?path=${encodeURIComponent(photoFilePath)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <img
                src={`${API_BASE}/api/filesystem/image?path=${encodeURIComponent(photoFilePath)}`}
                alt={photoMatch?.[1] || 'Photo'}
                className="max-w-sm rounded cursor-pointer hover:opacity-90 transition-opacity"
              />
            </a>
          </div>
        )}
        {isPhoto && !photoFilePath && (
          <div className="flex items-center gap-1.5 mb-1 text-xs text-muted-foreground font-mono">
            <ImageIcon className="h-3.5 w-3.5" />
            <span>{photoMatch?.[1] || 'Photo'}</span>
          </div>
        )}

        {/* Message content */}
        {isUser ? (
          <div className={cn(
            'text-sm whitespace-pre-wrap',
            isCurrentUser && 'bg-primary/10 border border-primary/20 rounded px-3 py-2'
          )}>
            {rawContent}
          </div>
        ) : (
          <>
            <MarkdownContent
              content={displayContent}
              className={cn(
                'text-sm',
                '[&_p]:mb-1 [&_p]:last:mb-0',
              )}
            />

            {shouldCollapse && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-5 px-1.5 text-2xs text-muted-foreground hover:text-foreground font-mono mt-1"
              >
                {isCollapsed ? (
                  <>
                    <ChevronDown className="h-3 w-3 mr-0.5" />
                    +{messageContent.length - displayContent.length} chars
                  </>
                ) : (
                  <>
                    <ChevronUp className="h-3 w-3 mr-0.5" />
                    collapse
                  </>
                )}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ChatMessage({ message, toolCalls, thoughts, collapseCount, inboxAgentId: _inboxAgentId }: ChatMessageProps) {
  const agents = useAgentStore((s) => s.agents);
  const { username } = useAuthStore();

  // Check if this is a system notification
  const systemInfo = getSystemNotificationInfo(message);
  if (systemInfo) {
    return <SystemNotification message={message} info={systemInfo} collapseCount={collapseCount} />;
  }

  const isUserAgentId = (agent: string) =>
    agent === 'user' ||
    (username !== null && agent === username);

  const isUser = message.type === 'user' || isUserAgentId(message.from_agent);

  const rawContent = message.content;
  const photoMatch = rawContent.trimStart().match(/^\[photo(?::([^\]]+))?\]\s*/);
  const isPhoto = !!photoMatch;
  const photoFilePath = (message.metadata?.file_path as string) || null;

  const isCurrentUser = username !== null
    ? message.from_agent === username
    : (message.from_agent === 'user' || message.type === 'user');

  const agentData = !isUser ? agents.find(a => a.name === message.from_agent || a.id === message.from_agent) : null;
  const displayName = isUser
    ? (isCurrentUser ? 'you' : message.from_agent)
    : (agentData?.display_name || message.from_agent);

  const prefixInfo = !isUser ? parseMessagePrefix(rawContent) : null;

  return (
    <LogMessage
      message={message}
      toolCalls={toolCalls}
      thoughts={thoughts}
      collapseCount={collapseCount}
      isUser={isUser}
      isCurrentUser={isCurrentUser}
      displayName={displayName}
      agentData={agentData}
      prefixInfo={prefixInfo}
      photoMatch={photoMatch}
      photoFilePath={photoFilePath}
      isPhoto={isPhoto}
    />
  );
}
