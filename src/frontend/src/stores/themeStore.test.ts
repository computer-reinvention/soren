import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from './themeStore';

function resetStore() {
  useThemeStore.setState({ theme: 'system' });
  document.documentElement.classList.remove('dark');
}

describe('themeStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('setTheme("dark") adds the dark class to <html>', () => {
    useThemeStore.getState().setTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('setTheme("light") removes the dark class from <html>', () => {
    document.documentElement.classList.add('dark');
    useThemeStore.getState().setTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggleTheme flips between light and dark, resolving "system" to dark first', () => {
    // jsdom's matchMedia stub (test/setup.ts) reports matches: false, so
    // 'system' resolves to the store's own dark-default fallback.
    useThemeStore.setState({ theme: 'system' });
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists the selected theme to localStorage under the documented key', () => {
    useThemeStore.getState().setTheme('light');
    const raw = localStorage.getItem('soren-theme');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).state.theme).toBe('light');
  });
});
