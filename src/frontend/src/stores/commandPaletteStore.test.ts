import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandPaletteStore } from './commandPaletteStore';

describe('commandPaletteStore', () => {
  beforeEach(() => {
    useCommandPaletteStore.setState({ open: false, query: '' });
  });

  it('setOpen/setQuery update independently', () => {
    useCommandPaletteStore.getState().setOpen(true);
    expect(useCommandPaletteStore.getState().open).toBe(true);
    expect(useCommandPaletteStore.getState().query).toBe('');
  });

  // Regression guard for P5.5's /search slash command, which relies on this
  // exact combined behavior to open the palette pre-filled in one call.
  it('openWithQuery opens the palette AND sets the query in one call', () => {
    useCommandPaletteStore.getState().openWithQuery('worktree');
    const state = useCommandPaletteStore.getState();
    expect(state.open).toBe(true);
    expect(state.query).toBe('worktree');
  });
});
