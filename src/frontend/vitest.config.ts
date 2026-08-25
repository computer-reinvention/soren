import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const rootDir = import.meta.dirname;

/**
 * P6.1 — separate from vite.config.ts (not merged via vitest's
 * `defineConfig` re-export) so production build config stays exactly what
 * it was — modulePreload/no-manualChunks decisions from P4.6 are load-time
 * concerns that have no meaning under vitest's jsdom environment, and
 * mixing them risks the test config accidentally drifting the prod build
 * config or vice versa.
 */
export default mergeConfig(
  defineConfig({
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, './src'),
      },
    },
  }),
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    },
  })
);
