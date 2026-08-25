import { defineConfig, devices } from '@playwright/test';

/**
 * P6.1 — e2e smoke tests, run against an ALREADY-RUNNING soren instance
 * (`./soren.sh start`, or the dev server) rather than spinning one up via
 * Playwright's `webServer` option. This is a live multi-agent system with
 * a real supervisor and real mailbox — these tests must stay strictly
 * read-only / non-destructive against whatever instance they're pointed
 * at (see e2e/global-setup.ts for the one exception: a disposable
 * dev-verify* test account, created and torn down around the whole run).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // shared disposable auth account across the run
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: process.env.SOREN_BASE_URL || 'http://localhost:8000',
    storageState: './e2e/.auth/state.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
