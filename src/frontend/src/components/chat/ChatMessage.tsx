import { useState } from 'react';
import { cn, getAgentBadgeLabel, getAgentBadgeColor, parseMessagePrefix } from '@/lib/utils';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { MarkdownContent } from './MarkdownContent';
import { MessageActions } from './MessageActions';
import { useAgentStore } from '@/stores/agentStore';
import { useAuthStore } from '@/stores/authStore';
import { Bot, User, ChevronDown, ChevronUp, HeartPulse, ShieldAlert, Radio, ImageIcon } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
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
  // Get the first meaningful sentence, max 120 chars
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

// Regex to match @mentions (agent names are alphanumeric with hyphens)
const MENTION_REGEX = /@([\w-]+)/g;

/**
 * Renders text with @mentions highlighted as clickable colored badges.
 * Clicking a mention navigates to that agent in the sidebar.
 */
function renderWithMentions(text: string, className?: string) {
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(MENTION_REGEX)) {
    const mentionFull = match[0];
    const mentionName = match[1];
    const matchIndex = match.index!;

    // Add text before this match
    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex));
    }

    // Add highlighted, clickable mention
    parts.push(
      <button
        key={`${mentionName}-${matchIndex}`}
        className="inline-flex items-center bg-white/20 text-white font-medium rounded px-1 py-0.5 text-[0.9em] hover:bg-white/30 transition-colors cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          useAgentStore.getState().selectAgent(mentionName);
        }}
      >
        {mentionFull}
      </button>
    );

    lastIndex = matchIndex + mentionFull.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  // If no mentions found, return plain text
  if (parts.length === 0) {
    return <p className={className}>{text}</p>;
  }

  return <p className={className}>{parts}</p>;
}

// Get preview content, trying to not break markdown
function getPreviewContent(content: string): string {
  // If there's a code block near the start, include it
  const firstCodeBlockMatch = content.match(/```[\s\S]*?```/);
  if (firstCodeBlockMatch && firstCodeBlockMatch.index !== undefined) {
    const codeBlockEnd = firstCodeBlockMatch.index + firstCodeBlockMatch[0].length;
    if (codeBlockEnd <= PREVIEW_LENGTH * 2) {
      // Include the code block in preview
      return content.slice(0, codeBlockEnd);
    }
  }

  // Otherwise, truncate at a reasonable point
  let truncated = content.slice(0, PREVIEW_LENGTH);

  // Try to break at a sentence or paragraph
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
  const relativeTime = formatDistanceToNow(messageDate, { addSuffix: true });
  const preciseTime = format(messageDate, 'MMM d, yyyy h:mm:ss a');

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 py-1 max-w-full">
        <div className="flex-1 h-px bg-border/40" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors px-2 py-0.5 rounded-full hover:bg-muted/50 shrink-0"
        >
          <SystemIconComponent icon={info.icon} />
          <span className="font-medium">{info.label}</span>
          {collapseCount && collapseCount > 1 && (
            <span className="bg-muted-foreground/20 text-muted-foreground px-1.5 py-0 rounded-full text-[10px] font-medium">
              ×{collapseCount}
            </span>
          )}
          {!expanded && (
            <span className="max-w-[200px] truncate opacity-60">
              {info.summary}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="opacity-50 whitespace-nowrap">{relativeTime}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {preciseTime}
            </TooltipContent>
          </Tooltip>
          {expanded ? (
            <ChevronUp className="h-2.5 w-2.5 opacity-50" />
          ) : (
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          )}
        </button>
        <div className="flex-1 h-px bg-border/40" />
      </div>
      {expanded && (
        <div className="mx-8 bg-muted/30 border border-border/50 rounded-lg px-3 py-2 text-xs text-muted-foreground">
          <MarkdownContent content={message.content} className="text-xs [&_p]:mb-1 [&_p]:last:mb-0" />
        </div>
      )}
    </div>
  );
}

export function ChatMessage({ message, toolCalls, thoughts, collapseCount, inboxAgentId: _inboxAgentId }: ChatMessageProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const agents = useAgentStore((s) => s.agents);
  const { username } = useAuthStore();

  // Check if this is a system notification (heartbeat ping, sentry briefing, etc.)
  const systemInfo = getSystemNotificationInfo(message);
  if (systemInfo) {
    return <SystemNotification message={message} info={systemInfo} collapseCount={collapseCount} />;
  }

  // Recognise a from_agent as a human user if it's in the explicit set
  // or matches the logged-in username.
  const isUserAgentId = (agent: string) =>
    agent === 'user' ||
    (username !== null && agent === username);

  const isUser = message.type === 'user' || isUserAgentId(message.from_agent);

  let rawContent = message.content;
  // Strip [photo] / [photo:filename] prefix from raw content
  const photoMatch = rawContent.trimStart().match(/^\[photo(?::([^\]]+))?\]\s*/);
  if (photoMatch) rawContent = rawContent.trimStart().slice(photoMatch[0].length);

  // For mailbox messages, content is 'subject | body' — prefer body (fuller text)
  if (message.type === 'mailbox' && rawContent.includes(' | ')) {
    const pipeIdx = rawContent.indexOf(' | ');
    let bodyPart = rawContent.slice(pipeIdx + 3).trimStart();
    const bodyPhoto = bodyPart.match(/^\[photo(?::([^\]]+))?\]\s*/);
    if (bodyPhoto) bodyPart = bodyPart.slice(bodyPhoto[0].length);
    if (bodyPart.length > 0) rawContent = bodyPart;
  }

  const isPhoto = !!photoMatch;
  const photoFilePath = (message.metadata?.file_path as string) || null;
  const isInterAgent = !isUserAgentId(message.from_agent) && !isUserAgentId(message.to_agent);
  const showToIndicator = !isUser && !(message.from_agent === 'supervisor' && isUserAgentId(message.to_agent));
  // Only THIS user's messages align right — other users' messages align left (WhatsApp-style)
  const isCurrentUser = username !== null
    ? message.from_agent === username
    : (message.from_agent === 'user' || message.type === 'user');
  // User's messages always on the right, everything else on the left
  const alignRight = isCurrentUser;
  const messageDate = new Date(message.timestamp);
  const relativeTime = formatDistanceToNow(messageDate, { addSuffix: true });
  const preciseTime = format(messageDate, 'MMM d, yyyy h:mm:ss a');
  // Show display_name (given name) if available, fall back to from_agent
  const agentData = !isUser ? agents.find(a => a.name === message.from_agent || a.id === message.from_agent) : null;
  const displayName = isUser
    ? (isCurrentUser ? 'You' : message.from_agent)
    : (agentData?.display_name || message.from_agent);

  // Parse message prefix (e.g. [TASK], [DONE], [STATUS])
  const prefixInfo = !isUser ? parseMessagePrefix(rawContent) : null;
  const messageContent = prefixInfo ? prefixInfo.rest : rawContent;

  const previewContent = getPreviewContent(messageContent);
  const actuallyTruncated = previewContent.length < messageContent.length;
  const shouldCollapse =
    messageContent.length > COLLAPSE_THRESHOLD && actuallyTruncated && !isUser;
  const isCollapsed = shouldCollapse && !isExpanded;
  const displayContent = isCollapsed ? previewContent : messageContent;

  return (
    <div
      className={cn(
        'group flex gap-3 max-w-[85%]',
        alignRight ? 'ml-auto flex-row-reverse' : 'mr-auto',
        isInterAgent && 'opacity-80'
      )}
    >
      {/* Avatar */}
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarFallback
          className={cn(
            'text-xs',
            alignRight
              ? 'bg-primary text-white'
              : 'bg-secondary text-secondary-foreground'
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      {/* Message Bubble */}
      <div
        className={cn(
          'rounded-2xl px-4 py-2.5 min-w-0 relative',
          alignRight
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm',
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center gap-2 mb-1',
            alignRight ? 'flex-row-reverse' : ''
          )}
        >
          <span className="text-xs font-medium">{displayName}</span>
          {showToIndicator && (
            <span className={cn(
              'text-[10px]',
              alignRight ? 'text-white/40' : 'text-muted-foreground/50'
            )}>
              → {message.to_agent}
            </span>
          )}
          {!isUser && agentData?.display_name && agentData.display_name !== agentData.name && (
            <span className={cn(
              'text-[10px]',
              alignRight ? 'text-white/30' : 'text-muted-foreground/40'
            )}>
              {agentData.name}
            </span>
          )}
          {!isUser && agentData && (() => {
            const label = getAgentBadgeLabel(agentData);
            return (
              <Badge
                variant="outline"
                className={cn('text-[10px] h-4 px-1', getAgentBadgeColor(label))}
              >
                {label}
              </Badge>
            );
          })()}
          {prefixInfo && (
            <Badge
              variant="outline"
              className={cn('text-[10px] h-4 px-1 font-semibold', prefixInfo.className)}
            >
              {prefixInfo.label}
            </Badge>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  'text-[10px] cursor-default',
                  alignRight
                    ? 'text-white/70'
                    : 'text-muted-foreground'
                )}
              >
                {relativeTime}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {preciseTime}
            </TooltipContent>
          </Tooltip>
          {collapseCount && collapseCount > 1 && (
            <span
              className={cn(
                'text-[10px] font-medium px-1.5 py-0 rounded-full',
                alignRight
                  ? 'bg-white/20 text-white/80'
                  : 'bg-muted-foreground/20 text-muted-foreground'
              )}
            >
              ×{collapseCount}
            </span>
          )}

          {/* Message Actions - appear on hover */}
          <MessageActions
            content={message.content}
            isUser={alignRight}
            className={cn(
              'ml-auto',
              alignRight ? 'mr-auto ml-0' : ''
            )}
          />
        </div>

        {/* Interleaved thoughts + tool calls timeline */}
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
                className="max-w-sm rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
              />
            </a>
          </div>
        )}
        {isPhoto && !photoFilePath && (
          <div className="flex items-center gap-1.5 mb-1.5 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            <span>{photoMatch?.[1] || 'Photo'}</span>
          </div>
        )}

        {/* Content */}
        {isUser ? (
          renderWithMentions(rawContent, 'text-sm whitespace-pre-wrap')
        ) : (
          <>
            <MarkdownContent
              content={displayContent}
              className={cn(
                'text-sm',
                '[&_p]:mb-1 [&_p]:last:mb-0',
                '[&_pre]:bg-zinc-100 [&_pre]:dark:bg-zinc-800 [&_code]:bg-zinc-100 [&_code]:dark:bg-zinc-800'
              )}
            />

            {/* Collapse/Expand controls */}
            {shouldCollapse && (
              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  {isCollapsed ? (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" />
                      Show more ({messageContent.length - displayContent.length}{' '}
                      more chars)
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3 w-3 mr-1" />
                      Show less
                    </>
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
