import { create } from 'zustand';

/**
 * Open/close + query state for the global CommandPalette (Cmd+K). Lifted
 * out of the component's local useState (P5.5) so external triggers other
 * than the Cmd+K keybinding — specifically ChatInput's `/search <query>`
 * slash command — can open the palette pre-filled with a query, the same
 * way settingsPanelStore lets Header's gear icon and this same palette's
 * own "Settings" item share one dialog instance.
 */
interface CommandPaletteState {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  /** Open pre-filled with a query — used by ChatInput's /search command. */
  openWithQuery: (query: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  open: false,
  query: '',
  setOpen: (open) => set({ open }),
  setQuery: (query) => set({ query }),
  openWithQuery: (query) => set({ open: true, query }),
}));
