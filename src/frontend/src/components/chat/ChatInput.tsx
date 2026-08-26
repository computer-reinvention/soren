import { useState, useRef, useEffect, useCallback, type Ref } from 'react';
import { useNavigate } from 'react-router-dom';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Bot, Square, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';
import { cn, getAgentBadgeLabel, getAgentBadgeColor } from '@/lib/utils';
import { api } from '@/lib/api';
import { routes } from '@/lib/navigation';
import { useCommandPaletteStore } from '@/stores/commandPaletteStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { Agent } from '@/types/agent';

interface ChatInputProps {
  onSend: (message: string) => void;
  isPending?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLTextAreaElement>;
  agents?: Agent[];
  /** Command Center mode: resolves where the current text will be routed
   *  (first live @mention, else supervisor). Renders a routing chip. */
  resolveTarget?: (text: string) => string;
  onInterrupt?: () => void;
  isAgentWorking?: boolean;
  isInterrupting?: boolean;
  interruptedAt?: number | null;
  /**
   * P4.3: the send is optimistic (input clears immediately) so it feels
   * instant — but that means a failed send (e.g. offline) silently
   * discarded the user's message with zero feedback. The parent bumps
   * `nonce` on mutation error to restore `content` back into the textarea
   * instead of losing it.
   */
  failedSend?: { content: string; nonce: number; reason?: string } | null;
}

interface MentionState {
  active: boolean;
  query: string;
  startIndex: number; // cursor position of the '@' character
  selectedIndex: number;
}

interface SlashCommandState {
  active: boolean;
  query: string; // command name typed so far, no leading '/'
  selectedIndex: number;
}

interface SlashCommandFeedback {
  type: 'success' | 'error';
  text: string;
}

interface SlashCommandContext {
  navigate: ReturnType<typeof useNavigate>;
}

/**
 * P5.5 — slash commands. These execute directly against existing REST
 * endpoints (or open the global search) instead of being sent as a chat
 * message — `run()` never calls onSend.
 *
 * Deliberately NOT included: /spawn and /kill. There is no REST endpoint
 * for either (spawning/killing workers is shell-only via `tools/workers`,
 * per AGENTS.md's execution-engine section) and adding one just to satisfy
 * a chat command would mean exposing a much more consequential operation
 * over HTTP without the deliberation that deserves — mirrors this system's
 * existing stance of keeping soren.sh stop/restart sudo-gated rather than
 * agent-triggerable. Worth revisiting as its own reviewed feature, not a
 * side effect of this one.
 */
const SLASH_COMMANDS: Array<{
  name: string;
  argsHint: string;
  description: string;
  run: (arg: string, ctx: SlashCommandContext) => Promise<SlashCommandFeedback> | SlashCommandFeedback;
}> = [
  {
    name: 'compact',
    argsHint: '<agent>',
    description: 'Trigger context compaction for an agent',
    run: async (arg) => {
      if (!arg) return { type: 'error', text: 'Usage: /compact <agent>' };
      await api.compactAgent(arg);
      return { type: 'success', text: `Compaction triggered for ${arg}` };
    },
  },
  {
    name: 'wake',
    argsHint: '<agent>',
    description: 'Wake a sleeping worker',
    run: async (arg) => {
      if (!arg) return { type: 'error', text: 'Usage: /wake <agent>' };
      await api.wakeAgent(arg);
      return { type: 'success', text: `Wake requested for ${arg}` };
    },
  },
  {
    name: 'interrupt',
    argsHint: '<agent>',
    description: 'Interrupt an agent mid-task',
    run: async (arg) => {
      if (!arg) return { type: 'error', text: 'Usage: /interrupt <agent>' };
      await api.interruptAgent(arg);
      return { type: 'success', text: `Interrupt sent to ${arg}` };
    },
  },
  {
    name: 'status',
    argsHint: '[agent]',
    description: 'Open an agent (or the overview if none given)',
    run: (arg, ctx) => {
      ctx.navigate(arg ? routes.agent(arg) : routes.overview());
      return { type: 'success', text: arg ? `Opened ${arg}` : 'Opened overview' };
    },
  },
  {
    name: 'search',
    argsHint: '<query>',
    description: 'Open global search (agents, tasks, files, journal, memory)',
    run: (arg) => {
      useCommandPaletteStore.getState().openWithQuery(arg);
      return { type: 'success', text: arg ? `Searching "${arg}"` : 'Opened search' };
    },
  },
];

// P5.6: message history recall. sessionStorage (not localStorage) — history
// is meant to be "what I typed this browsing session", not a permanent
// cross-session log; it also naturally clears on browser close, which
// matters more here than in a normal shell since messages can contain
// sensitive task content.
const HISTORY_KEY = 'soren_chat_history';
const HISTORY_MAX = 50;

function loadHistory(): string[] {
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(history: string[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_MAX)));
  } catch {
    // sessionStorage unavailable/full — history just won't persist, non-fatal
  }
}

export function ChatInput({ onSend, isPending, placeholder, inputRef, agents = [], resolveTarget, onInterrupt, isAgentWorking, isInterrupting, interruptedAt, failedSend }: ChatInputProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [showInterruptFeedback, setShowInterruptFeedback] = useState(false);
  const lastRestoredNonce = useRef<number | null>(null);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<MentionState>({
    active: false,
    query: '',
    startIndex: 0,
    selectedIndex: 0,
  });
  // P5.5: slash command autocomplete. Unlike @mention, always anchored at
  // index 0 — slash commands are only recognized as the very first thing
  // typed in the message, not mid-sentence.
  const [slashCommand, setSlashCommand] = useState<SlashCommandState>({
    active: false,
    query: '',
    selectedIndex: 0,
  });
  const [commandFeedback, setCommandFeedback] = useState<SlashCommandFeedback | null>(null);
  // History recall (P5.6): null = not currently browsing history.
  const historyRef = useRef<string[]>(loadHistory());
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const draftRef = useRef('');

  // Use effect to sync internal ref with external ref
  useEffect(() => {
    if (inputRef && typeof inputRef === 'object' && 'current' in inputRef && internalRef.current) {
      (inputRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = internalRef.current;
    }
  }, [inputRef]);

  // Restore a failed send back into the textarea instead of losing it.
  useEffect(() => {
    if (!failedSend || failedSend.nonce === lastRestoredNonce.current) return;
    lastRestoredNonce.current = failedSend.nonce;
    setMessage((current) => current || failedSend.content);
    internalRef.current?.focus();
  }, [failedSend]);

  const textareaRef = internalRef;

  // Auto-resize textarea. When empty, clear any inline height entirely and
  // let CSS's min-h-[44px] govern it directly — measuring scrollHeight for
  // an empty box serves no purpose (there's nothing to size around) and
  // was a real bug: on mount, this ran before web fonts had necessarily
  // settled, and `scrollHeight` at that instant reflected fallback-font
  // line metrics — taller than the real font's. That inflated pixel value
  // then got set as a fixed inline style and never re-measured again
  // (this effect only reruns when `message` changes, and an untouched
  // empty textarea never does), so the box stayed visibly oversized the
  // entire time it sat empty. Confirmed directly: forcing a re-render post
  // font-load dropped the measured height from ~62px to 42px.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!message) {
      textarea.style.height = '';
      return;
    }
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [message, textareaRef]);

  // Show "Agent interrupted" feedback briefly after a successful interrupt
  useEffect(() => {
    if (!interruptedAt) return;
    setShowInterruptFeedback(true);
    const timer = setTimeout(() => setShowInterruptFeedback(false), 3000);
    return () => clearTimeout(timer);
  }, [interruptedAt]);

  // Slash command result feedback (P5.5) — same transient-banner pattern
  // as the interrupt feedback above.
  useEffect(() => {
    if (!commandFeedback) return;
    const timer = setTimeout(() => setCommandFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [commandFeedback]);

  // Filter agents based on mention query
  const filteredAgents = mention.active
    ? agents.filter((a) =>
        a.id.toLowerCase().includes(mention.query.toLowerCase()) ||
        (a.display_name && a.display_name.toLowerCase().includes(mention.query.toLowerCase()))
      )
    : [];

  // Filter slash commands by name prefix (not fuzzy — these are short,
  // memorable names, prefix match is more predictable while typing).
  const filteredCommands = slashCommand.active
    ? SLASH_COMMANDS.filter((c) => c.name.startsWith(slashCommand.query.toLowerCase()))
    : [];

  // Close either dropdown when clicking outside. Mention and slash-command
  // dropdowns can't both be active at once (see SlashCommandState's
  // comment), so one shared handler covers both.
  useEffect(() => {
    if (!mention.active && !slashCommand.active) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMention((m) => ({ ...m, active: false }));
        setSlashCommand((s) => ({ ...s, active: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mention.active, slashCommand.active]);

  // Scroll selected item into view
  useEffect(() => {
    if ((!mention.active && !slashCommand.active) || !dropdownRef.current) return;
    const selected = dropdownRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [mention.selectedIndex, mention.active, slashCommand.selectedIndex, slashCommand.active]);

  const insertSlashCommand = useCallback((name: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const newMessage = `/${name} `;
    setMessage(newMessage);
    setSlashCommand({ active: false, query: '', selectedIndex: 0 });
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = newMessage.length;
      textarea.focus();
    });
  }, [textareaRef]);

  const insertMention = useCallback((agentId: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const before = message.slice(0, mention.startIndex);
    const after = message.slice(textarea.selectionStart);
    const newMessage = `${before}@${agentId} ${after}`;
    setMessage(newMessage);
    setMention({ active: false, query: '', startIndex: 0, selectedIndex: 0 });

    // Restore cursor position after the inserted mention
    requestAnimationFrame(() => {
      const cursorPos = before.length + agentId.length + 2; // +2 for '@' and space
      textarea.selectionStart = cursorPos;
      textarea.selectionEnd = cursorPos;
      textarea.focus();
    });
  }, [message, mention.startIndex, textareaRef]);

  // P5.5: `/name arg` where `name` matches a known slash command runs that
  // command directly (REST call, navigation, or opening search) instead of
  // being sent as a chat message. Anything starting with `/` that ISN'T a
  // recognized command name falls through to a normal send — chat content
  // starting with a literal slash shouldn't silently do nothing.
  const matchSlashCommand = (text: string) => {
    const match = text.match(/^\/(\S+)(?:\s+(.*))?$/s);
    if (!match) return null;
    const command = SLASH_COMMANDS.find((c) => c.name === match[1]);
    return command ? { command, arg: (match[2] ?? '').trim() } : null;
  };

  const runSlashCommand = async (trimmed: string) => {
    const matched = matchSlashCommand(trimmed);
    if (!matched) return false;
    try {
      const feedback = await matched.command.run(matched.arg, { navigate });
      setCommandFeedback(feedback);
    } catch (err) {
      setCommandFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : `/${matched.command.name} failed`,
      });
    }
    setMessage('');
    setSlashCommand({ active: false, query: '', selectedIndex: 0 });
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    return true;
  };

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed || isPending) return;

    if (await runSlashCommand(trimmed)) return;

    onSend(trimmed);
    // Record history (skip immediate consecutive duplicates, e.g. retrying
    // the exact same failed send shouldn't produce two identical entries).
    const hist = historyRef.current;
    if (hist[hist.length - 1] !== trimmed) {
      hist.push(trimmed);
      if (hist.length > HISTORY_MAX) hist.shift();
      saveHistory(hist);
    }
    setHistoryIndex(null);
    setMessage('');
    setMention({ active: false, query: '', startIndex: 0, selectedIndex: 0 });
    // Reset height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  /**
   * ArrowUp/Down history recall — only when not navigating the @mention
   * dropdown. Entering history mode (first ArrowUp) requires the cursor at
   * the very start, so it doesn't hijack normal cursor movement while
   * drafting a fresh multi-line message. Once already browsing
   * (historyIndex !== null), further ArrowUp/ArrowDown presses continue
   * paging regardless of cursor position — gating continuation on cursor
   * position too caused a real bug: recalling a shorter/longer entry moves
   * the cursor to a different edge than the one the *other* direction's
   * gate expects, so switching direction (or repeating the same direction
   * past the first press) silently fell through to native cursor movement
   * and ate a keypress instead of paging.
   */
  const handleHistoryKey = (e: React.KeyboardEvent): boolean => {
    const textarea = textareaRef.current;
    if (!textarea) return false;
    const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
    const hist = historyRef.current;

    if (e.key === 'ArrowUp' && (historyIndex !== null || atStart) && hist.length > 0) {
      e.preventDefault();
      const newIndex = historyIndex === null ? hist.length - 1 : Math.max(0, historyIndex - 1);
      if (historyIndex === null) draftRef.current = message;
      const recalled = hist[newIndex];
      setMessage(recalled);
      setHistoryIndex(newIndex);
      // Cosmetic only — continuing to page no longer depends on cursor
      // position (see comment above), so this is purely for a nicer
      // editing experience (cursor ready at the end of the recalled line).
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = recalled.length;
      });
      return true;
    }

    if (e.key === 'ArrowDown' && historyIndex !== null) {
      e.preventDefault();
      const next = historyIndex >= hist.length - 1 ? draftRef.current : hist[historyIndex + 1];
      setMessage(next);
      setHistoryIndex(historyIndex >= hist.length - 1 ? null : historyIndex + 1);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = next.length;
      });
      return true;
    }

    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle slash command dropdown navigation — checked first, same
    // priority position as the @mention block below (the two can't be
    // active simultaneously, see SlashCommandState's docstring).
    if (slashCommand.active && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashCommand((s) => ({
          ...s,
          selectedIndex: (s.selectedIndex + 1) % filteredCommands.length,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashCommand((s) => ({
          ...s,
          selectedIndex: (s.selectedIndex - 1 + filteredCommands.length) % filteredCommands.length,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSlashCommand(filteredCommands[slashCommand.selectedIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashCommand({ active: false, query: '', selectedIndex: 0 });
        return;
      }
    }

    // Handle mention dropdown navigation
    if (mention.active && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          selectedIndex: (m.selectedIndex + 1) % filteredAgents.length,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMention((m) => ({
          ...m,
          selectedIndex: (m.selectedIndex - 1 + filteredAgents.length) % filteredAgents.length,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(filteredAgents[mention.selectedIndex].id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention({ active: false, query: '', startIndex: 0, selectedIndex: 0 });
        return;
      }
    }

    // Normal Enter to send (when mention dropdown is NOT open)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      handleHistoryKey(e);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(value);
    // A real edit (not our own programmatic recall) means the user is now
    // drafting something new — stop treating further ArrowDown as "return
    // to draft" once they've already started typing over a recalled entry.
    if (historyIndex !== null) setHistoryIndex(null);

    // Detect slash command trigger — only ever at the very start of the
    // message, and only while typing the command name itself (before the
    // first space, which starts the argument). This is deliberately
    // stricter than @mention: unlike agent tags, which make sense
    // mid-sentence, a slash command IS the message.
    if (value.startsWith('/') && !value.slice(0, cursorPos).includes(' ')) {
      setSlashCommand({ active: true, query: value.slice(1, cursorPos), selectedIndex: 0 });
      return;
    }
    if (slashCommand.active) {
      setSlashCommand({ active: false, query: '', selectedIndex: 0 });
    }

    // Detect @mention trigger
    // Look backwards from cursor to find an '@' that starts a mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      // Check that the '@' is at start of input or preceded by whitespace
      const charBefore = lastAtIndex > 0 ? value[lastAtIndex - 1] : ' ';
      if (charBefore === ' ' || charBefore === '\n' || lastAtIndex === 0) {
        const query = textBeforeCursor.slice(lastAtIndex + 1);
        // Only activate if the query doesn't contain spaces (still typing the mention)
        if (!query.includes(' ')) {
          setMention({
            active: true,
            query,
            startIndex: lastAtIndex,
            selectedIndex: 0,
          });
          return;
        }
      }
    }

    // No active mention
    if (mention.active) {
      setMention({ active: false, query: '', startIndex: 0, selectedIndex: 0 });
    }
  };

  return (
    <div className={cn('border-t bg-background/50 backdrop-blur-sm', isMobile ? 'p-2.5' : 'p-4')}>
      <div className="relative">
        {/* @mention autocomplete dropdown */}
        {mention.active && filteredAgents.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-[200px] overflow-y-auto"
          >
            <div className="py-1">
              {filteredAgents.map((agent, index) => (
                <button
                  key={agent.id}
                  data-selected={index === mention.selectedIndex}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                    index === mention.selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted/50'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent textarea blur
                    insertMention(agent.id);
                  }}
                  onMouseEnter={() =>
                    setMention((m) => ({ ...m, selectedIndex: index }))
                  }
                >
                  <div className="h-6 w-6 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                    <Bot className="h-3 w-3 text-secondary-foreground" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-medium">
                      {agent.display_name || agent.id}
                    </span>
                    {agent.display_name && agent.display_name !== agent.id && (
                      <span className="text-muted-foreground ml-1.5 text-xs">
                        {agent.id}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const label = getAgentBadgeLabel(agent);
                    return (
                      <span className={cn(
                        'ml-auto text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 border',
                        getAgentBadgeColor(label)
                      )}>
                        {label}
                      </span>
                    );
                  })()}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* No matches message */}
        {mention.active && mention.query.length > 0 && filteredAgents.length === 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50">
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No agents matching &ldquo;@{mention.query}&rdquo;
            </div>
          </div>
        )}

        {/* Slash command autocomplete dropdown (P5.5) */}
        {slashCommand.active && filteredCommands.length > 0 && (
          <div
            ref={dropdownRef}
            className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50 max-h-[200px] overflow-y-auto"
          >
            <div className="py-1">
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.name}
                  data-selected={index === slashCommand.selectedIndex}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                    index === slashCommand.selectedIndex
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-muted/50'
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertSlashCommand(cmd.name);
                  }}
                  onMouseEnter={() => setSlashCommand((s) => ({ ...s, selectedIndex: index }))}
                >
                  <Zap className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="font-mono font-medium">/{cmd.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{cmd.argsHint}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{cmd.description}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {slashCommand.active && slashCommand.query.length > 0 && filteredCommands.length === 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-lg shadow-lg z-50">
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No command matching &ldquo;/{slashCommand.query}&rdquo;
            </div>
          </div>
        )}

        {/* Slash command result feedback */}
        {commandFeedback && (
          <div
            role="status"
            className={cn(
              'mb-2 flex items-center gap-1.5 text-xs animate-in fade-in duration-200',
              commandFeedback.type === 'success'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-700 dark:text-red-400'
            )}
          >
            {commandFeedback.type === 'success' ? (
              <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {commandFeedback.text}
          </div>
        )}

        {/* Command Center routing chip — where this message will be delivered */}
        {resolveTarget && (
          <div className={cn(
            'flex items-center gap-1.5 text-muted-foreground',
            isMobile ? 'mb-1 text-2xs' : 'mb-1.5 text-xs'
          )}>
            <Bot className="h-3 w-3" />
            <span>
              →{' '}
              <span className={cn(
                'font-medium',
                resolveTarget(message) !== 'supervisor' && 'text-primary'
              )}>
                {resolveTarget(message)}
              </span>
            </span>
          </div>
        )}

        {/* Interrupt feedback */}
        {showInterruptFeedback && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-orange-700 dark:text-orange-400 animate-in fade-in duration-200">
            <Square className="h-3 w-3 fill-current" />
            Agent interrupted
          </div>
        )}

        {/* Failed send — message restored above, not lost (P4.3) */}
        {failedSend && failedSend.nonce === lastRestoredNonce.current && (
          <div
            role="alert"
            className="mb-2 flex items-center gap-1.5 text-xs text-red-700 dark:text-red-400 animate-in fade-in duration-200"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            {failedSend.reason || 'Send failed — message restored below, check your connection and retry'}
          </div>
        )}

        <div className={cn('flex items-end', isMobile ? 'gap-1.5' : 'gap-2')}>
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Type a message — Enter to send, @mention agents, /command'}
            disabled={isPending}
            className={cn(
              'min-h-[44px] max-h-[200px] resize-none',
              // Tighter vertical padding on mobile — the 44px floor (a
              // touch-target minimum, not a font-driven height) still
              // holds either way. Font itself is untouched: Textarea's
              // own text-base (16px) on mobile is deliberate, not
              // something to shrink (see the placeholder comment above).
              isMobile ? 'py-1.5' : 'py-2',
              'bg-muted/50 border-muted-foreground/20',
              'focus-visible:ring-1 focus-visible:ring-primary'
            )}
            rows={1}
          />
          {/* Send / Interrupt button — morphs based on agent activity */}
          {isAgentWorking || isInterrupting ? (
            <Button
              onClick={onInterrupt}
              disabled={isInterrupting}
              size="icon"
              className="h-11 w-11 flex-shrink-0 bg-orange-500 hover:bg-red-500 text-white"
              title="Interrupt agent"
            >
              {isInterrupting ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Square className="h-4 w-4 fill-current" />
              )}
              <span className="sr-only">{isInterrupting ? 'Interrupting…' : 'Interrupt agent'}</span>
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!message.trim() || isPending}
              size="icon"
              className="h-11 w-11 flex-shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              <span className="sr-only">{isPending ? 'Sending…' : 'Send message'}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
