import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Terminal display preferences (P5.7). Persisted so font size/scrollback
 * survive refresh — small, standalone store rather than folding into the
 * general prefs API (GET/PUT /api/prefs) since that endpoint is currently
 * scoped to heartbeat config only (see P5.2) and this is purely a client
 * display concern with no server-side meaning.
 */
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 20;
const FONT_STEP = 1;

interface TerminalSettingsState {
  fontSize: number;
  scrollback: number;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  setScrollback: (lines: number) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsState>()(
  persist(
    (set) => ({
      fontSize: 13,
      scrollback: 10_000,
      increaseFontSize: () =>
        set((s) => ({ fontSize: Math.min(MAX_FONT_SIZE, s.fontSize + FONT_STEP) })),
      decreaseFontSize: () =>
        set((s) => ({ fontSize: Math.max(MIN_FONT_SIZE, s.fontSize - FONT_STEP) })),
      setScrollback: (lines) => set({ scrollback: Math.max(500, Math.min(50_000, lines)) }),
    }),
    { name: 'soren-terminal-settings' }
  )
);
