import { test, expect } from '@playwright/test';

// The shared logged-in storageState (playwright.config.ts) marks onboarding
// as already-seen so the other spec files aren't blocked by it. These
// tests need the opposite starting state, so an init script clears that
// key before every page load in this file — more deterministic than
// trying to override `storageState` per-file, since that only seeds state
// once at context creation rather than guaranteeing it on every navigation.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('soren-onboarding');
  });
});

test('a first-time user sees the onboarding modal and can close it', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: /welcome to soren/i });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(dialog).not.toBeVisible();
  // Not asserting persistence across a reload here — this test's own
  // beforeEach clears the "seen" flag on every navigation (including a
  // reload), which would make the modal correctly reappear and falsely
  // look like a bug. onboardingStore's persistence itself is exactly the
  // kind of pure-logic behavior a unit test covers more reliably.
});

test('the onboarding modal can be stepped through with Next', async ({ page }) => {
  await page.goto('/');
  // Not scoped by name — the dialog's accessible name IS the step title
  // (aria-labelledby the DialogTitle), so a name filter here would stop
  // matching the instant the title changes on the very next line.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Welcome to SOREN');

  await dialog.getByRole('button', { name: 'Next' }).click();
  // Step 2's title ("Supervisor + Workers") replaces step 1's — confirms
  // Next actually advances rather than being a no-op.
  await expect(dialog).toContainText('Supervisor + Workers');
});

test('the final step runs a real connection check and can be skipped without sending a message', async ({ page }) => {
  await page.goto('/');
  const dialog = page.getByRole('dialog');

  // 5 informational steps, then the interactive final step.
  for (let i = 0; i < 5; i++) {
    await dialog.getByRole('button', { name: 'Next' }).click();
  }
  await expect(dialog).toContainText('Getting Started');

  // A real GET /api/webhooks/health call, not a canned string — against
  // this live instance it should resolve to "verified".
  await expect(dialog.getByText(/server connection verified/i)).toBeVisible({ timeout: 10_000 });

  // Deliberately does NOT fill in and send the message field here — this
  // runs against a live instance with a real supervisor, and sending a
  // message is a genuinely visible side effect (not just a local state
  // change), unlike everything else these specs touch. The skip path
  // exercises the rest of this step's logic without that side effect.
  await dialog.getByRole('button', { name: /skip, i'll send a message later/i }).click();
  await expect(dialog).not.toBeVisible();
});
