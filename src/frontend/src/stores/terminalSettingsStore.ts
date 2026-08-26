import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Terminal display preferences (P5.7). Persisted so font size/scrollback
 * survive refresh — small, standalone store rather than folding into the
 * general prefs API (GET/PUT /api/prefs) since that endpoint is currently
 * scoped to heartbeat config only (see P5.2) and this is purely a client
 * display concern with no server-side meaning.
 *
 * Font size is tracked per device class (desktop vs. mobile), not as one
 * shared value: a phone terminal is only usable at all if it fits enough
 * columns, which means going much smaller than a desktop user would ever
 * want. A single shared value would force a wrong-for-someone default no
 * matter which way it leaned. The mobile default (8px) intentionally
 * trades typical body-text readability for column count — that's the
 * whole point on a screen this size.
 */
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 20;
const FONT_STEP = 1;

interface TerminalSettingsState {
  desktopFontSize: number;
  mobileFontSize: number;
  scrollback: number;
  increaseFontSize: (mobile: boolean) => void;
  decreaseFontSize: (mobile: boolean) => void;
  setScrollback: (lines: number) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsState>()(
  persist(
    (set) => ({
      desktopFontSize: 13,
      mobileFontSize: 8,
      scrollback: 10_000,
      increaseFontSize: (mobile) =>
        set((s) =>
          mobile
            ? { mobileFontSize: Math.min(MAX_FONT_SIZE, s.mobileFontSize + FONT_STEP) }
            : { desktopFontSize: Math.min(MAX_FONT_SIZE, s.desktopFontSize + FONT_STEP) }
        ),
      decreaseFontSize: (mobile) =>
        set((s) =>
          mobile
            ? { mobileFontSize: Math.max(MIN_FONT_SIZE, s.mobileFontSize - FONT_STEP) }
            : { desktopFontSize: Math.max(MIN_FONT_SIZE, s.desktopFontSize - FONT_STEP) }
        ),
      setScrollback: (lines) => set({ scrollback: Math.max(500, Math.min(50_000, lines)) }),
    }),
    {
      name: 'soren-terminal-settings',
      version: 1,
      // v0 stored a single shared `fontSize` — carry it over as the
      // desktop value (that's what it was tuned for) and give mobile its
      // own separate, much smaller default rather than inheriting it.
      migrate: (persisted, version) => {
        const state = persisted as Partial<TerminalSettingsState> & { fontSize?: number };
        if (version === 0 && typeof state.fontSize === 'number') {
          const { fontSize, ...rest } = state;
          return { ...rest, desktopFontSize: fontSize, mobileFontSize: 8 };
        }
        return state;
      },
    }
  )
);
