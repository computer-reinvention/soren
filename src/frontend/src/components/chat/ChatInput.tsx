import { useState, useRef, useEffect, useCallback, type Ref } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Loader2, Bot, Square, AlertTriangle } from 'lucide-react';
import { cn, getAgentBadgeLabel, getAgentBadgeColor } from '@/lib/utils';
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
  failedSend?: { content: string; nonce: number } | null;
}

interface MentionState {
  active: boolean;
  query: string;
  startIndex: number; // cursor position of the '@' character
  selectedIndex: number;
}

export function ChatInput({ onSend, isPending, placeholder, inputRef, agents = [], resolveTarget, onInterrupt, isAgentWorking, isInterrupting, interruptedAt, failedSend }: ChatInputProps) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedSend]);

  const textareaRef = internalRef;

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [message, textareaRef]);

  // Show "Agent interrupted" feedback briefly after a successful interrupt
  useEffect(() => {
    if (!interruptedAt) return;
    setShowInterruptFeedback(true);
    const timer = setTimeout(() => setShowInterruptFeedback(false), 3000);
    return () => clearTimeout(timer);
  }, [interruptedAt]);

  // Filter agents based on mention query
  const filteredAgents = mention.active
    ? agents.filter((a) =>
        a.id.toLowerCase().includes(mention.query.toLowerCase()) ||
        (a.display_name && a.display_name.toLowerCase().includes(mention.query.toLowerCase()))
      )
    : [];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!mention.active) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMention((m) => ({ ...m, active: false }));
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mention.active]);

  // Scroll selected item into view
  useEffect(() => {
    if (!mention.active || !dropdownRef.current) return;
    const selected = dropdownRef.current.querySelector('[data-selected="true"]');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }, [mention.selectedIndex, mention.active]);

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

  const handleSubmit = () => {
    const trimmed = message.trim();
    if (trimmed && !isPending) {
      onSend(trimmed);
      setMessage('');
      setMention({ active: false, query: '', startIndex: 0, selectedIndex: 0 });
      // Reset height after sending
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setMessage(value);

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
    <div className="p-4 border-t bg-background/50 backdrop-blur-sm">
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

        {/* Command Center routing chip — where this message will be delivered */}
        {resolveTarget && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
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
          <div className="mb-2 flex items-center gap-1.5 text-xs text-orange-500 dark:text-orange-400 animate-in fade-in duration-200">
            <Square className="h-3 w-3 fill-current" />
            Agent interrupted
          </div>
        )}

        {/* Failed send — message restored above, not lost (P4.3) */}
        {failedSend && failedSend.nonce === lastRestoredNonce.current && (
          <div
            role="alert"
            className="mb-2 flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400 animate-in fade-in duration-200"
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
            Send failed — message restored below, check your connection and retry
          </div>
        )}

        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Type a message — Enter to send, @mention agents'}
            disabled={isPending}
            className={cn(
              'min-h-[44px] max-h-[200px] resize-none',
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
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Square className="h-4 w-4 fill-current" />
              )}
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!message.trim() || isPending}
              size="icon"
              className="h-11 w-11 flex-shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
