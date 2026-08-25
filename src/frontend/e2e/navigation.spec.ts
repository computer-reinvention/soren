import { test, expect } from '@playwright/test';

/**
 * Read-only smoke tests — confirm the shell, routing, and command palette
 * work end-to-end against a real running instance. Nothing here sends a
 * message, mutates an agent, or writes any state.
 */

test('overview loads with the persistent shell (sidebar, tabs, status bar)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /system overview/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'projects and agents' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
});

test('the skip link is the first focusable element and targets #main-content', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText('Skip to main content');
  await expect(focused).toHaveAttribute('href', '#main-content');
});

test('client-side route changes move focus to the main content region', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /tasks/i }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.locator('#main-content')).toBeFocused();
});

test('Cmd+K opens the command palette and Escape closes it', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByPlaceholder(/search agents, tasks, files/i)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('the reliability dashboard is reachable and renders its sections', async ({ page }) => {
  await page.goto('/reliability');
  await expect(page.getByRole('heading', { name: /agent reliability/i })).toBeVisible();
  await expect(page.getByText(/verification leaderboard/i)).toBeVisible();
});

test('settings panel opens from the header and shows all sections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/^appearance$/i)).toBeVisible();
  await expect(dialog.getByText(/^notifications$/i)).toBeVisible();
  await expect(dialog.getByText(/^terminal$/i)).toBeVisible();
  await page.keyboard.press('Escape');
});
