import { test, expect } from '@playwright/test';

/**
 * P6.2 — visual regression baselines.
 *
 * Deliberately narrow scope: this is a live multi-agent system, and most
 * of the dashboard (chat feed, activity timeline, token/cost counters,
 * timestamps, agent status) changes from one second to the next because
 * a real supervisor is actually running. Pixel-diffing those views
 * against a fixed baseline would be flaky by construction, not by
 * accident — a red diff would usually mean "the supervisor did
 * something" rather than "a UI regression happened".
 *
 * These specs instead cover screens that are genuinely static for a
 * given app state: the login form (no data), the onboarding modal's
 * informational steps (hardcoded copy), and the Settings panel (driven
 * entirely by local zustand stores, no live queries). If you want to
 * add another view, verify with two consecutive baseline updates a few
 * seconds apart that the screenshot is byte-identical before assuming
 * it's a safe target.
 *
 * Baselines live in e2e/visual.spec.ts-snapshots/ (committed to git).
 * Regenerate after an intentional visual change:
 *   npx playwright test visual.spec.ts --update-snapshots
 */

test.describe('login page', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
  });

  test('unauthenticated login form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('username')).toBeVisible();
    await expect(page).toHaveScreenshot('login-page.png', {
      // The whole viewport rather than a locator — this page has no
      // live-data regions to accidentally include.
      fullPage: true,
      animations: 'disabled',
    });
  });
});

test.describe('onboarding modal', () => {
  test.beforeEach(async ({ page }) => {
    // Same technique as onboarding.spec.ts — force the "first run" state
    // regardless of what the shared storageState says.
    await page.addInitScript(() => {
      window.localStorage.removeItem('soren-onboarding');
    });
  });

  const steps = [
    'Welcome to SOREN',
    'Supervisor + Workers',
    'Self-Healing Safety',
    'Real-Time Dashboard',
    'Persistent Memory',
  ];

  for (let i = 0; i < steps.length; i++) {
    test(`step ${i + 1}: ${steps[i]}`, async ({ page }) => {
      await page.goto('/');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      for (let click = 0; click < i; click++) {
        await dialog.getByRole('button', { name: 'Next' }).click();
      }
      await expect(dialog).toContainText(steps[i]);
      await expect(dialog).toHaveScreenshot(`onboarding-step-${i + 1}.png`, {
        animations: 'disabled',
      });
    });
  }
  // Deliberately stops before the final "Getting Started" step — that one
  // renders a real GET /api/webhooks/health result and is therefore live
  // data, not a static screen (see onboarding.spec.ts's functional test
  // for that step instead).
});

test.describe('settings panel', () => {
  test('all sections', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open settings' }).click();
    const dialog = page.getByRole('dialog', { name: /settings/i });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveScreenshot('settings-panel.png', {
      animations: 'disabled',
    });
  });
});
