# Frontend

The SOREN dashboard: a React SPA served by the FastAPI backend at `/`, talking to it over REST + WebSocket. This document covers the design system, component patterns, state management, keyboard shortcuts, testing, and day-to-day development workflow. For the system as a whole, start at [`docs/README.md`](./README.md) or the root [`AGENTS.md`](../AGENTS.md).

## Stack

| | |
|---|---|
| Framework | React 18 + TypeScript, Vite build |
| Routing | react-router-dom v7 (client-side, URL is the single source of truth for selection state) |
| Server state | `@tanstack/react-query` |
| Client state | `zustand` (one small store per concern; some `persist`-backed to localStorage, see "State management") |
| Styling | Tailwind CSS + shadcn/ui primitives (Radix under the hood) |
| Icons | `lucide-react` |
| Terminal | `@xterm/xterm` + `@xterm/addon-fit` / `-search` / `-web-links` |
| Task DAG | `@xyflow/react` |
| Task board drag/drop | `@dnd-kit/core` |
| Markdown / syntax highlighting | `react-markdown`, `shiki` |
| Command palette | `cmdk` |
| Unit/component tests | `vitest` + `@testing-library/react` |
| E2E tests | `@playwright/test` |

## Directory structure

```
src/frontend/src/
  components/      One directory per feature area (chat/, tasks/, activity/,
                    sidebar/, settings/, onboarding/, ...), plus components/ui/
                    for shadcn primitives (Button, Dialog, Input, ...).
  routes/           Route-level page components (OverviewPage, DiffPage,
                    ReliabilityDashboardPage, pages.tsx for thinner ones).
  hooks/            Data-fetching hooks (useAgents, useTasks, ...) and
                    behavior hooks (useKeyboardShortcuts, useChatKeyboard, ...).
  stores/           zustand stores — see "State management" below.
  lib/              Pure utilities: api.ts (the whole REST client), utils.ts,
                    navigation.ts (route builders), density.ts, notifications.ts.
  types/            Shared TypeScript interfaces mirroring backend Pydantic
                    models (Agent, Task, Message, Memory, ...).
  test/             vitest setup (test/setup.ts — jsdom polyfills, see below).
e2e/                 Playwright specs + global-setup/teardown.
```

Co-located `*.test.ts(x)` files live next to what they test (e.g.
`stores/themeStore.test.ts`, `components/sidebar/AgentRow.test.tsx`) rather
than a parallel `__tests__/` tree.

## Design system

### Philosophy: Terminal Console

Dark-first, monospace, information-dense. Section headers are lowercase
source text transformed to uppercase via CSS (`uppercase tracking-wider`) —
when writing a test assertion or a new heading, write the lowercase text
and let CSS do the capitalization; don't hardcode uppercase strings in
JSX/tests.

### Theme tokens (`src/index.css`)

CSS custom properties on `:root` (light, kept as a fallback) and `.dark`
(the actual default — see `stores/themeStore.ts`: defaults to `'system'`,
which itself falls back to dark). Standard shadcn token names:
`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
`--secondary`, `--muted`, `--accent`, `--destructive`, `--border`,
`--input`, `--ring`, `--radius`, plus a `--sidebar-*` family and
`--status-{green,amber,red,blue,purple,cyan}` for operational status colors.

Reference them via Tailwind classes (`bg-background`, `text-muted-foreground`,
`border-border`), never raw `hsl(var(--x))` in component code.

**Known limitation (flagged during the P5.8 accessibility pass, not yet
fixed):** light mode's `--muted-foreground` is only ~4.6:1 contrast at full
opacity — any Tailwind opacity modifier (`/70`, `/80`, ...) pushes it below
the 4.5:1 WCAG AA threshold. Status/badge colors have the same problem in
reverse: e.g. `amber-600` passes on the dark background but fails on light,
while `amber-700` is the reverse. Every color-contrast fix that shipped in
P5.8/P6.3 uses an explicit `dark:` variant pair for exactly this reason —
**don't add a bare `text-{color}-{shade}` for anything status/text-bearing
without checking both themes**, since a value that looks fine in the (more
commonly tested) dark theme can silently fail contrast in light mode. A
full light-mode contrast pass (choosing correct per-color shade pairs
project-wide) is a known follow-up, not yet done.

### Custom Tailwind variants (`tailwind.config.js`)

Three project-specific variants, each solving a real bug (not decorative):

- **`can-hover:`** — `@media (hover: hover)`. `opacity-0 group-hover:opacity-100` patterns are permanently invisible on touch devices (no hover state to reveal them). Pattern: `opacity-100 can-hover:opacity-0 can-hover:group-hover:opacity-100` — visible by default, hidden-until-hover only where a real hover capability exists.
- **`compact:`** — `:is(html.density-compact &)`, driven by `lib/density.ts` + the `ui_density` preference (synced via `GET/PUT /api/prefs`, the one setting in Settings that round-trips server-side — see `components/settings/SettingsPanel.tsx`'s docblock for why the rest stay in localStorage). Applied to a handful of high-traffic list surfaces (sidebar rows, activity items, task cards), not a global spacing-token system.
- Standard `dark:` is used constantly; there's no custom `light:` variant since unprefixed IS the light-mode value (see the contrast note above).

### Reduced motion — two layers, know which one applies

1. `src/index.css` has a blanket `@media (prefers-reduced-motion: reduce)` block that force-disables `.animate-heartbeat`, `.animate-pulse`, and `.animate-spin` globally via `animation: none !important`. Any component using these exact utility classes is *already* covered — no per-component work needed.
2. Everything else — `tailwindcss-animate`'s enter/exit transitions (`animate-in`, `fade-in`, `zoom-in`, `slide-in-from-*`, used by every Dialog/Sheet/Tooltip/DropdownMenu) — is **not** covered by that blanket rule and needs an explicit `motion-reduce:animate-none` on the component. This is already applied to the shared primitives in `components/ui/` (dialog, sheet, tooltip, dropdown-menu, skeleton) — if you add a new one using `animate-in`, add the variant too.

## Component patterns

### Selection state lives in the URL, not in stores

`lib/navigation.ts`'s `routes` object is the single source of truth for URL
shapes (`routes.agent(id)`, `routes.file(path)`, `routes.tasks()`, ...).
Which agent/file/archive is open, and which center-panel tab is active, are
all derived from the current route — never duplicated into a zustand store.
This is what makes deep links, browser back/forward, and page refresh work
for free. `useRouteAgentId()` (in the same file) reads the current agent id
from *any* component under the router, not just the matched route (used by
right-rail panels that need to stay in sync with whatever the center panel
is showing).

### Global overlays are Dialogs in a shared store, not route state

`CommandPalette`, `SettingsPanel`, `ShortcutHelp`, and `OnboardingModal` are
all mounted once in `App.tsx`'s `Shell()` and toggled via a tiny
`{ open, setOpen }` zustand store per overlay (`commandPaletteStore.ts`,
`settingsPanelStore.ts`) rather than local component state — this is what
lets multiple trigger points (a header button *and* a command-palette item,
for instance) open the exact same dialog instance. Content pages
(`/reliability`, `/tasks`, ...) are routes; app-wide overlays for
*doing something to the current view* are Dialogs. Don't build a new route
for something that's conceptually a modal, and don't add local `useState`
for a dialog's open state if more than one place needs to trigger it.

### List-item memoization

Hot lists (chat messages, activity timeline, thoughts) wrap their row
component in `React.memo` (`ChatMessage`, `ActivityTimelineItem`,
`ThoughtStream`'s `ThoughtItem`). This only helps if the data feeding those
rows is referentially stable when nothing relevant changed — see
`hooks/useMessageFeed.ts`'s `EMPTY_MAP` pattern: correlation hooks fed by
global stores return a **shared, stable empty Map** instead of allocating
`new Map()` on every no-op recompute, specifically so the memo boundary
downstream has something to bail out on. If you add a new derived-data hook
feeding a memoized list, follow the same pattern: don't allocate a new
container (Map/array/object) unless the contents actually differ.

### Slash-command / mention-style dropdowns

`ChatInput.tsx`'s `@mention` autocomplete and `/slash-command` autocomplete
are both hand-rolled absolute-positioned popups anchored to the textarea
(not `cmdk`, which is built for `CommandPalette`'s full-screen modal case).
If you need another inline-anchored autocomplete, clone this pattern rather
than reaching for `cmdk` again.

### `cn()` for all conditional classes

`lib/utils.ts`'s `cn()` (clsx + tailwind-merge) resolves Tailwind class
conflicts correctly (e.g. `cn('px-2', condition && 'px-4')` correctly wins
with `px-4`, unlike plain string concatenation). Always use it instead of
template-literal class strings once there's more than one conditional class.

## State management

### Server state — React Query

Every network read goes through a `useQuery` hook in `hooks/` (e.g.
`useAgents`, `useTasks`, `useFilesystem`), never a raw `fetch` in a
component. Mutations use `useMutation` with `queryClient.invalidateQueries`
on success. `lib/api.ts` is the single REST client — every endpoint the
frontend calls has a typed wrapper there; don't call `fetch` directly from
a component.

### Client state — zustand, one store per concern

Current stores (`stores/`): `activityStore`, `agentEventStore`,
`agentStore`, `authStore`, `commandPaletteStore`, `connectionStore`,
`heartbeatStore`, `layoutStore`, `mobileNavStore`, `notificationStore`,
`onboardingStore`, `projectStore`, `sessionStore`, `settingsPanelStore`,
`terminalSettingsStore`, `terminalStore`, `themeStore`, `thoughtStore`.

A handful are `persist`-backed to localStorage where the setting genuinely
should survive a refresh (`themeStore`, `notificationStore`,
`terminalSettingsStore`, `onboardingStore`, `layoutStore`, `projectStore`);
the rest — including `commandPaletteStore` and `settingsPanelStore` — are
deliberately plain in-memory stores, since dialog-open state or live
WebSocket-derived data should always start fresh on load, not resume
mid-session.

One setting round-trips through the backend instead of localStorage:
`ui_density`, via `GET/PUT /api/prefs`, consumed through
`hooks/usePrefs.ts` (not its own zustand store) — see that hook's
docblock for why density specifically is worth server-side sync when
theme/notifications/terminal settings aren't.

### WebSocket → store flow

`hooks/useWebSocket.ts` (mounted once in `Shell()`) is the only WebSocket
connection. Incoming events are dispatched into the relevant store
(`activityStore.addActivity`, `thoughtStore` for agent reasoning, etc.) —
components never touch the WebSocket directly, they subscribe to the store.

## Keyboard shortcuts

Defined in `hooks/useKeyboardShortcuts.ts`; the reference list shown in the
`?` help overlay and in Settings both import `lib/shortcuts.ts`'s
`SHORTCUT_GROUPS` (don't maintain a second copy). It lives in its own
module rather than in `ShortcutHelp.tsx` because a data constant exported
alongside a component breaks Vite Fast Refresh for that file — if you add
another shared data constant next to a component, consider the same split.
**Shortcuts are not currently remappable** — every binding is a hardcoded
`switch` in the hook.

| Keys | Action |
|---|---|
| `⌘1` – `⌘4` | overview / chat / terminal / tasks |
| `g` then `o`/`c`/`t`/`e` | overview / chat / tasks / terminal |
| `j` / `k` | next / previous agent (sidebar order) |
| `esc` | back to overview |
| `⌘K` | command palette |
| `/` | focus sidebar filter |
| `⌘↵` | send message |
| `` ctrl+` `` | toggle terminal |
| `?` | toggle shortcut help overlay |

Shortcuts are suppressed while focus is inside an input/textarea/select or
while any `[role="dialog"]` is open (except `?`, which still toggles help).

## Testing

### Unit / component (`npm run test`, `npm run test:watch`, `npm run test:ui`)

`vitest` + `@testing-library/react`, config in `vitest.config.ts` (kept
**separate** from `vite.config.ts` — production build config like
`modulePreload`/no-`manualChunks` has no meaning under jsdom, and merging
risks the two drifting into each other).

`src/test/setup.ts` polyfills `window.localStorage`, `window.sessionStorage`,
and `window.matchMedia` — jsdom under this vitest/node version combination
doesn't provide any of the three, which breaks every `persist`-backed
zustand store immediately. If tests start throwing on `localStorage.setItem`
after a dependency bump, check this file first before assuming the app code
regressed.

Favor testing pure functions (`lib/utils.ts`, `components/tasks/task-utils.ts`)
and store behavior directly over shallow component snapshot tests. Where a
component test does exist (`AgentRow.test.tsx`,
`useKeyboardShortcuts.test.tsx`), it asserts real behavior (accessible
name includes live status, `j`/`k` actually navigates) — several of these
are explicit regression guards for bugs that were found and fixed earlier
in the same phase (see the test file comments for which).

### E2E (`npm run test:e2e`)

`@playwright/test`, config in `playwright.config.ts`. **Runs against an
already-running soren instance** (`./soren.sh start` or the dev server) —
deliberately does **not** use Playwright's `webServer` option to spin up
its own, since this is a live multi-agent system with a real supervisor and
mailbox, not a disposable fixture.

- `e2e/global-setup.ts` creates a disposable `dev-verify-e2e` account via
  `tools/auth` (same convention used for manual live-browser QA
  throughout this project — see the `verification` skill), logs in for
  real, and seeds a Playwright `storageState` with the resulting token.
  `e2e/global-teardown.ts` removes the account again.
- Specs must stay **read-only / non-destructive** against whatever
  instance they run against, with the narrow exception of the disposable
  account itself. If a flow's only interesting behavior is a real,
  visible side effect against the live system (e.g. onboarding's "send
  your first message" step, which posts to the real supervisor), test the
  UI up to that point plus any skip/cancel path, and verify the actual
  side effect manually instead — see `e2e/onboarding.spec.ts`'s comments
  for a worked example.
- This app's convention is lowercase source text, capitalized via CSS
  (see "Design system" above) — text-matching assertions should use
  case-insensitive regexes (`/system overview/i`), not the visually
  capitalized string.
- A `Dialog`'s accessible name is often `aria-labelledby` its own
  `DialogTitle` — if that title changes during the test (e.g. onboarding
  advancing between steps), a locator scoped by that name will stop
  matching the moment it changes. Scope by role alone and assert content
  with `toContainText`/`toHaveText` instead once the name isn't stable.

### What's *not* set up

`npm run lint --max-warnings 0` passes clean, but it's advisory — nothing
currently blocks a commit on it (there's no pre-commit hook or required
check). Run it yourself before committing frontend changes.

## Development workflow

```bash
cd src/frontend
npm install
npm run dev          # vite dev server on :5173, proxies /api and /ws to :8000
npm run build         # tsc --noEmit, then vite build -> dist/
npm run typecheck     # tsc --noEmit only
npm run lint          # eslint --max-warnings 0
npm run test           # vitest run (unit/component)
npm run test:watch     # vitest watch mode
npm run test:ui        # vitest's browser UI
npm run test:e2e       # playwright, against a running instance (see Testing)
```

The backend must be running (`./soren.sh start`, or `uv run uvicorn
src.server.main:app --reload --host 0.0.0.0 --port 8000` from the repo
root) for `npm run dev`'s proxy and for e2e tests to have anything to talk
to. Backend Python
changes require a restart to take effect — `./soren.sh detached-restart
--restart --detach` is the agent-safe way to do this without killing the
tmux session (see the root `AGENTS.md`).

Static assets under `dist/assets/` are Vite content-hashed and served with
`Cache-Control: public, max-age=31536000, immutable`; `index.html` and
everything else with a fixed filename is `no-cache` (see
`src/server/main.py`'s `SPAStaticFiles`) — a new build is always safe to
deploy without stale-cache issues, but don't rename anything under
`dist/` to a fixed (non-hashed) filename without also making it `no-cache`.

## Progressive Web App

`public/manifest.webmanifest` + `public/sw.js` (registered in
`main.tsx`, production builds only). The service worker is cache-first for
the static app shell and **always network-only for `/api/` and `/ws`** —
this is a live-monitoring tool, stale agent/task data would be actively
misleading, so only truly static assets are ever cached offline.
