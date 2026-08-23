import { create } from 'zustand';

export type TerminalMode = 'shell' | 'soren';

/**
 * Terminal session state. Whether the terminal is VISIBLE is routing state
 * (/terminal); this store only tracks what must outlive route changes:
 * the server-side session mode and the keep-mounted flag that preserves the
 * PTY session + scrollback when the user tabs away.
 */
interface TerminalState {
  terminalMode: TerminalMode;
  /** Set on first /terminal visit — the terminal stays mounted (hidden) after. */
  hasOpenedTerminal: boolean;
  setTerminalMode: (mode: TerminalMode) => void;
  markTerminalOpened: () => void;
}

export const useTerminalStore = create<TerminalState>()((set) => ({
  terminalMode: 'shell',
  hasOpenedTerminal: false,
  setTerminalMode: (mode) => set({ terminalMode: mode }),
  markTerminalOpened: () => set({ hasOpenedTerminal: true }),
}));
