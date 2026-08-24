import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // P4.6: Vite's default modulePreload behaviour eagerly <link
    // rel="modulepreload">s every chunk reachable via dynamic import from
    // the entry — including ones only reached through React.lazy() routes
    // a given session may never visit (chat's markdown renderer, the
    // files/diff viewers' shiki grammars, task board's dnd-kit/xyflow).
    // That silently defeats route-level code-splitting. Remote/mobile
    // bandwidth is exactly what this phase is optimizing for, so disable
    // the eager-preload heuristic — native dynamic import() still fetches
    // each chunk the moment its route/Suspense boundary is actually hit.
    modulePreload: false,
    // No manualChunks: explicit chunk grouping for packages that also
    // transitively pull in React (react-markdown, shiki's few React-aware
    // bits) caused Rollup to duplicate React itself into those chunks
    // instead of sharing the copy already in the main entry — a strictly
    // worse outcome than just letting Rollup's automatic per-dynamic-import
    // splitting handle it, which correctly dedupes shared modules against
    // whichever lazy route chunk(s) actually reference them.
  },
});
