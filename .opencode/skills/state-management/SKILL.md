---
name: state-management
description: Separate client state from server cache, structure zustand stores well, and keep WebSocket-driven state in sync. Load before adding stores, syncing server data, or wiring real-time updates.
---

# State Management

Most "state management" bugs are category errors: treating a server cache like client state, or vice versa. Classify first, then pick the tool.

## The Fundamental Split

- **Client state**: things only the browser knows — open panels, form drafts, selected tab, theme. Owned by the client, never stale. → `useState` or zustand.
- **Server cache**: things the server owns that the client keeps a *copy* of — agents, messages, journal entries. Always potentially stale; needs fetch/invalidate/refresh semantics. → dedicated cache layer (query library) or a disciplined store fed by WebSocket.
- Mixing them in one blob store is how you get "the UI shows a dead agent as running" — nobody owned staleness.

## Zustand Patterns (SOREN's store layer)

- **One store per domain**, matching the existing pattern: `agentStore`, `activityStore`, `connectionStore`, `layoutStore`. Don't create a mega-store; don't create a store per component either.
- Put **actions inside the store** next to the state they mutate: `useAgentStore.getState().upsertAgent(a)`. Components call actions; they never `setState` store internals ad hoc.
- **Subscribe narrowly**: `useAgentStore(s => s.agents[id]?.status)`. Selecting whole objects/arrays re-renders on every change; select primitives or use shallow equality for tuples.
- Keep stores **normalized**: `Record<id, Agent>` + ordered id arrays, not nested arrays of arrays. Updates become O(1) upserts and selectors stay simple.
- Non-reactive reads (event handlers, WebSocket callbacks) use `useStore.getState()` — no hook needed, no render triggered.
- Derived data lives in selectors, not in the store: store `messages`, select `unreadCount`.

## WebSocket Sync

The hard part is not receiving events — it's convergence after disconnects.

- **Snapshot + deltas**: on (re)connect, fetch full state via REST, *then* apply WebSocket deltas. Deltas alone drift; snapshots alone are stale between polls.
- Events must be **idempotent upserts** keyed by ID: applying `agent_event` twice must equal applying it once. Redelivery happens.
- Handle **out-of-order** arrivals: compare timestamps/sequence before overwriting — a late `IN_PROGRESS` must not clobber a newer `COMPLETE`.
- On reconnect (SOREN's `useWebSocket` auto-reconnects): re-fetch the snapshot. Anything that happened while disconnected is simply gone from the event stream.
- Buffer or drop UI updates gracefully during disconnect; surface connection status (`connectionStore`) so users know data may be stale.

## Optimistic Updates

- Use only when the action almost always succeeds and latency is user-visible (sending a message).
- Recipe: apply locally with a temp ID → send → reconcile with server response (replace temp ID) → on failure, roll back AND tell the user.
- If you can't write the rollback in one sentence, don't do the optimistic update.

## Checklist

1. Each piece of state classified: client state or server cache? Owner identified.
2. Store subscriptions are narrow selectors; no whole-store subscriptions in hot components.
3. WebSocket handlers are idempotent upserts; reconnect triggers snapshot re-fetch.
4. No duplicated copies of server data across stores — one domain, one home.
5. Stale-data behavior is explicit: what does the user see when the socket drops?

## Anti-Patterns

- Copying props into local state "to edit them" without a clear commit/discard boundary.
- Two stores holding the same entity (agent in `agentStore` AND embedded in `activityStore` items) with no single source of truth.
- Event handlers that mutate `agents.find(...)` in place — always immutable updates or store actions.
- Persisting server cache to localStorage — you've built a stale-data time capsule.
- Global store as a junk drawer: if only one component reads it, it's local state.
