import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'dark'; // default to dark for a coding tool
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(resolveTheme(theme));
      },
      toggleTheme: () => {
        const current = resolveTheme(get().theme);
        const newTheme: Theme = current === 'dark' ? 'light' : 'dark';
        set({ theme: newTheme });
        applyTheme(resolveTheme(newTheme));
      },
    }),
    {
      name: 'soren-theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(resolveTheme(state.theme));
        }
      },
    }
  )
);

// Listen for OS theme changes when in 'system' mode
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const store = useThemeStore.getState();
    if (store.theme === 'system') {
      applyTheme(getSystemTheme());
    }
  });
}

function applyTheme(theme: 'light' | 'dark') {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}
