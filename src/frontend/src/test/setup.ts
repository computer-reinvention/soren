import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount React trees between tests — without this, components rendered
// in one test (and any DOM-global side effects they register, e.g. this
// app's several `document.addEventListener` keyboard-shortcut hooks) leak
// into the next test's assertions.
afterEach(() => {
  cleanup();
});

// jsdom 30 under this vitest/node combination doesn't expose
// window.localStorage at all (confirmed: `typeof window.localStorage` is
// 'undefined', not just an empty store) — every zustand store in this app
// that uses the `persist` middleware (theme, terminal settings, ...) throws
// on first write without this. A minimal in-memory Storage impl is enough
// for tests; nothing here needs real cross-reload persistence.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, String(value)),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', { value: createMemoryStorage() });
}
if (!window.sessionStorage) {
  Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage() });
}

// jsdom doesn't implement matchMedia — several stores/hooks in this app
// (themeStore's system-preference listener, useIsMobile) call it at
// import/mount time and would throw without a stub.
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
