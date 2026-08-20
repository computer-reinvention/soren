import { create } from 'zustand';

export type CenterMode = 'chat' | 'terminal';
export type TerminalMode = 'shell' | 'soren';

interface TerminalState {
  /** What the center panel is currently showing. */
  centerMode: CenterMode;
  /** Which server-side session the web terminal is attached to. */
  terminalMode: TerminalMode;
  /**
   * Set once the terminal has been opened at least once — the terminal stays
   * mounted (display:none) afterwards so the session/scrollback survive
   * flipping back to chat.
   */
  hasOpenedTerminal: boolean;
  setCenterMode: (mode: CenterMode) => void;
  toggleTerminal: () => void;
  setTerminalMode: (mode: TerminalMode) => void;
}

// Deliberately does NOT touch agentStore/viewerStore: opening the terminal
// never clears agent/file selection, and closing it returns to whatever the
// chat stack was showing before.
export const useTerminalStore = create<TerminalState>()((set) => ({
  centerMode: 'chat',
  terminalMode: 'shell',
  hasOpenedTerminal: false,

  setCenterMode: (mode) =>
    set((state) => ({
      centerMode: mode,
      hasOpenedTerminal: state.hasOpenedTerminal || mode === 'terminal',
    })),

  toggleTerminal: () =>
    set((state) => ({
      centerMode: state.centerMode === 'terminal' ? 'chat' : 'terminal',
      hasOpenedTerminal: true,
    })),

  setTerminalMode: (mode) => set({ terminalMode: mode }),
}));
