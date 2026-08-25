import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Creates a disposable `dev-verify-e2e` account (same convention used
 * throughout this project for manual live-browser verification — see
 * AGENTS.md / the verification skill) via `tools/auth`, logs in against the
 * real API, and writes a Playwright storageState seeded with the resulting
 * token under the app's `soren_token` localStorage key (see
 * stores/authStore.ts — it's a plain string, not JSON/zustand-persist).
 *
 * Removed again in global-teardown.ts. Never reuses a real user account —
 * these tests run against a live multi-agent system and must not touch
 * anything that isn't this disposable identity.
 */
const TEST_USERNAME = 'dev-verify-e2e';
const TEST_PASSWORD = 'e2e-test-password-not-a-secret';

function repoRoot(): string {
  // src/frontend -> repo root
  return path.resolve(import.meta.dirname, '../../..');
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL || process.env.SOREN_BASE_URL || 'http://localhost:8000';

  execFileSync('./tools/auth', ['add-user', TEST_USERNAME, TEST_PASSWORD], {
    cwd: repoRoot(),
    stdio: 'pipe',
  });

  const res = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`e2e login as ${TEST_USERNAME} failed: ${res.status} ${await res.text()}`);
  }
  const { token } = await res.json();

  const stateDir = path.resolve(import.meta.dirname, '.auth');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    path.join(stateDir, 'state.json'),
    JSON.stringify({
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: 'soren_token', value: token },
            // Every account starts with hasSeenOnboarding: false — without
            // this, OnboardingModal covers the whole screen on this brand
            // new test account and blocks every other navigation test.
            // Onboarding itself is exercised separately (see onboarding.spec.ts).
            { name: 'soren-onboarding', value: JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }) },
          ],
        },
      ],
    })
  );
}

export { TEST_USERNAME, TEST_PASSWORD };
