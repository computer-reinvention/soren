import { useEffect, useCallback, RefObject } from 'react';

interface UseChatKeyboardOptions {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onSend?: () => void;
  onClearInput?: () => void;
  onEscape?: () => void;
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for the chat interface
 *
 * Shortcuts:
 * - Cmd/Ctrl + Enter: Send message
 * - Escape: Clear input / call onEscape handler
 * - Cmd/Ctrl + K: Focus chat input
 */
export function useChatKeyboard({
  inputRef,
  onSend,
  onClearInput,
  onEscape,
  enabled = true,
}: UseChatKeyboardOptions) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      const isMod = event.metaKey || event.ctrlKey;

      // Cmd/Ctrl + Enter: Send message
      if (isMod && event.key === 'Enter') {
        event.preventDefault();
        onSend?.();
        return;
      }

      // Escape: Clear input or call escape handler
      if (event.key === 'Escape') {
        event.preventDefault();

        // If there's a specific escape handler, use it
        if (onEscape) {
          onEscape();
          return;
        }

        // Otherwise, clear the input
        if (onClearInput) {
          onClearInput();
        }

        // Blur the input
        if (document.activeElement === inputRef.current) {
          inputRef.current?.blur();
        }
        return;
      }

      // Cmd/Ctrl + K: Focus chat input
      if (isMod && event.key === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        return;
      }
    },
    [enabled, inputRef, onSend, onClearInput, onEscape]
  );

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, handleKeyDown]);

  // Return focus function for external use
  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  return { focusInput };
}
