export type Density = 'comfortable' | 'compact';

/**
 * Toggles the `density-compact` class on <html>, which the `compact:`
 * Tailwind variant (tailwind.config.js) targets. Mirrors themeStore's
 * applyTheme() pattern (class on documentElement, not a CSS variable), but
 * this one is driven by server state (GET/PUT /api/prefs, see
 * hooks/usePrefs.ts) rather than localStorage, since density is the one
 * setting in the P5.2 settings panel worth syncing across browsers/devices.
 *
 * Scope note: this only affects the handful of high-traffic list surfaces
 * that have been given `compact:` classes (sidebar agent rows, activity
 * timeline items, task cards) — not a global spacing-token system.
 */
export function applyDensity(density: Density): void {
  document.documentElement.classList.toggle('density-compact', density === 'compact');
}
