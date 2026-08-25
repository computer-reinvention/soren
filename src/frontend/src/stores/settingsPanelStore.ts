import { create } from 'zustand';

/**
 * Open/close state for the Settings dialog (P5.2). Not persisted — it
 * always starts closed. A tiny shared store rather than component state
 * because two separate trigger points (Header's gear icon, CommandPalette's
 * "Settings" item) need to open the same dialog instance, which is mounted
 * once in Shell() alongside ShortcutHelp/OnboardingModal — same reasoning
 * as mobileNavStore for the mobile drawer triggers.
 */
interface SettingsPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSettingsPanelStore = create<SettingsPanelState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
