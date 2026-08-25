import { test, expect } from '@playwright/test';

// Override the shared logged-in storageState (see playwright.config.ts) —
// these tests specifically exercise the login form itself. Onboarding is
// pre-marked seen so the modal doesn't cover the post-login assertions
// below (it's a Radix Dialog — correctly aria-hides the rest of the page
// while open, so "SYSTEM OVERVIEW" would otherwise be genuinely
// unreachable in the accessibility tree, not just visually covered).
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:8000',
        localStorage: [
          { name: 'soren-onboarding', value: JSON.stringify({ state: { hasSeenOnboarding: true }, version: 0 }) },
        ],
      },
    ],
  },
});

const TEST_USERNAME = 'dev-verify-e2e';
const TEST_PASSWORD = 'e2e-test-password-not-a-secret';

test('an unauthenticated visitor sees the login form, not the dashboard', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('username')).toBeVisible();
  await expect(page.getByLabel('password')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SYSTEM OVERVIEW' })).not.toBeVisible();
});

test('logging in with the disposable test account reaches the dashboard', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('username').fill(TEST_USERNAME);
  await page.getByLabel('password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await expect(page.getByRole('heading', { name: 'SYSTEM OVERVIEW' })).toBeVisible({ timeout: 10_000 });
});

test('an invalid password shows an error and does not log in', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('username').fill(TEST_USERNAME);
  await page.getByLabel('password').fill('definitely-wrong-password');
  await page.getByRole('button', { name: /log in|sign in/i }).click();
  await expect(page.getByText(/invalid|failed/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'SYSTEM OVERVIEW' })).not.toBeVisible();
});
