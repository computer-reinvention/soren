/**
 * Keyboard shortcut reference data — the single source of truth for both
 * the `?` help overlay (ShortcutHelp.tsx) and the Settings panel's
 * shortcuts tab (SettingsPanel.tsx), so the two never drift into two
 * different lists.
 *
 * Split into its own module (rather than living in ShortcutHelp.tsx)
 * because Vite Fast Refresh only works for files that exclusively export
 * components — a data constant living alongside `ShortcutHelp`/
 * `ShortcutGroupsGrid` breaks HMR for the whole file every time this list
 * changes.
 *
 * Shortcuts aren't remappable — every actual binding is hardcoded in
 * `hooks/useKeyboardShortcuts.ts`. This list is read-only documentation
 * of those bindings, kept in sync by hand.
 */
export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'navigate',
    items: [
      ['⌘1 – ⌘4', 'overview / chat / terminal / tasks'],
      ['g then o·c·t·e', 'overview / chat / tasks / terminal'],
      ['j / k', 'next / previous agent'],
      ['esc', 'back to overview'],
    ],
  },
  {
    title: 'find',
    items: [
      ['⌘K', 'command palette'],
      ['/', 'focus sidebar filter'],
    ],
  },
  {
    title: 'chat & terminal',
    items: [
      ['⌘↵', 'send message'],
      ['ctrl+`', 'toggle terminal'],
    ],
  },
  {
    title: 'help',
    items: [['?', 'toggle this overlay']],
  },
];
