---
name: component-architecture
description: Structure React components with sound composition, state colocation, and render performance judgment. Load before building or refactoring frontend components.
---

# Component Architecture

Good components are boring: small, predictable, and replaceable. If explaining a component takes longer than reading it, it's too big.

## Composition Over Configuration

- Prefer `children` and slot props over boolean prop explosions. `<Card header={<X/>}>` scales; `<Card showHeader hasIcon isCompact variant="dense">` does not.
- When a component grows a second responsibility, split it. The seam is usually visible: two groups of props that never interact.
- Container/presentation split still earns its keep: one component fetches/subscribes, another renders props. The presentational one is trivially testable and reusable.
- Extract custom hooks when logic (not markup) repeats: `useWebSocketStatus()`, `usePolling(fn, ms)`. Hooks are the composition unit for behavior.

## State Colocation

**State lives at the lowest component that needs it — and no lower or higher.**

- Input drafts, open/closed toggles, hover state → local `useState` in the component itself.
- Shared by siblings → lift to the nearest common parent, pass down.
- Shared across routes/panels → store (zustand in SOREN). Reaching for the global store for a dropdown toggle is the classic mistake.
- Derivable state is not state: `const filtered = items.filter(...)` inline (or `useMemo` if provably hot). Storing derived values invites desync bugs.
- URL is state too: current tab, selected agent, filters — put them in the route/query params so refresh and share work.

## Render Performance

Measure before optimizing — React DevTools Profiler, not vibes. Then, in order of impact:

1. **Push state down.** A keystroke in a search box shouldn't re-render the whole page; move the input+results into their own subtree.
2. **Narrow store subscriptions.** `useStore(s => s.agents[id].status)` re-renders on that slice only; `useStore()` re-renders on everything.
3. **Stable keys.** `key={item.id}`, never `key={index}` on reorderable lists — index keys cause state bleeding between rows.
4. **Virtualize long lists** (100+ rows): render the viewport, not the dataset.
5. `memo`/`useMemo`/`useCallback` last, and only with a profiler trace proving the win. Memoizing everything adds cost and hides real problems.

## Effects Discipline

- `useEffect` is for synchronizing with external systems (WebSocket, DOM, timers) — not for reacting to state with more state. Cascading effects (`effect sets A → effect on A sets B`) are a redesign signal.
- Every effect that subscribes/opens/starts must return a cleanup that unsubscribes/closes/stops. Missing cleanups = duplicate WebSocket handlers after every remount.
- If data-fetch-on-mount is getting complex (dedupe, cache, refetch), that's server-cache territory (see `state-management`), not more effect code.

## Checklist

1. Component fits one responsibility; props read like a coherent API.
2. State is at the lowest viable level; nothing derivable is stored.
3. Lists have stable identity keys; long lists virtualized.
4. Effects have cleanups; no effect-chains.
5. `npm run typecheck` and `npm run build` pass; no `any`-typed props.

## Anti-Patterns

- God components: 400-line files mixing fetch, transform, and three layouts.
- Prop drilling through 4+ layers — restructure with composition (pass the composed element down) before reaching for context/store.
- Boolean prop soup (`isMini isLarge isInline`) — use a `variant` union type.
- Copy-pasting a component to change one section instead of extracting the shared shell.
- `useEffect` + `setState` to compute what a plain expression could.
