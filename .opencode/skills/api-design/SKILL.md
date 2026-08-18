---
name: api-design
description: Design REST APIs with correct semantics, versioning, pagination, error contracts, and idempotency. Load before adding or changing any HTTP endpoint.
---

# API Design

An API is a contract, not an implementation detail. Every change is a promise you make to callers you can't see.

## REST Semantics

- **GET** reads, never mutates. If a GET changes state, crawlers and retries will corrupt data.
- **POST** creates or triggers; not idempotent by default. **PUT** replaces whole resources (idempotent). **PATCH** partially updates. **DELETE** is idempotent — deleting twice returns 204/404, never 500.
- Nouns in paths, verbs in methods: `POST /api/tasks`, not `POST /api/createTask`.
- Status codes carry meaning: 200 ok, 201 created (+ Location), 204 no body, 400 malformed, 401 unauthenticated, 403 unauthorized, 404 missing, 409 conflict, 422 semantically invalid, 429 rate-limited. **Never let bad input produce a 500** — that's a bug, not an error response.

## Error Contract

Pick one error shape and use it everywhere:

```json
{ "error": { "code": "task_not_found", "message": "Task 42 does not exist", "field": null } }
```

- Machine-readable `code` (stable, documented), human `message` (changeable).
- Validation failures list *every* bad field in one response, not one at a time.
- Never leak stack traces, SQL, or internal paths in error bodies.

## Pagination

- Any collection endpoint that can grow needs pagination from day one — retrofitting breaks clients.
- Cursor-based (`?cursor=...&limit=50`) beats offset for live data (offset skips/duplicates rows under concurrent writes). Offset is acceptable for small, admin-only lists.
- Always return the page metadata: `next_cursor` (or `has_more`), and cap `limit` server-side.

## Idempotency

- Retries happen: flaky networks, impatient clients, duplicated queue messages. Design for at-least-once delivery.
- For POSTs that must not double-execute (payments, task creation from webhooks), accept an `Idempotency-Key` header and dedupe server-side.
- PUT/DELETE should be naturally idempotent — same request twice, same end state.

## Versioning

- Additive changes (new optional fields, new endpoints) don't need a version bump. Clients must ignore unknown fields.
- Breaking changes (removing/renaming fields, changing types or semantics) require a new version path (`/api/v2/...`) or explicit coordination with every consumer.
- In SOREN: publish the contract (endpoint, body, response, errors) in your `[DONE]` report whenever it changes. Silent contract changes stall the frontend.

## Checklist Before Shipping an Endpoint

1. Error paths return 400/404/422 with the standard error shape — verified with `curl`, not assumed.
2. Input validated at the boundary (types, ranges, lengths); assume hostile callers.
3. Collection endpoints paginated and capped.
4. Idempotent where retries are plausible.
5. Response shape documented in the `[DONE]` report; no undocumented fields.
6. A test exists for the happy path AND at least one failure path.

## Anti-Patterns

- Tunneling everything through POST with an `action` field.
- Returning 200 with `{"success": false}` — status codes exist, use them.
- Boolean-blind responses: `{"ok": true}` with no resource ID for follow-up calls.
- Chatty designs requiring N+1 round trips — offer expansion (`?include=`) or a composite endpoint.
- Breaking a field's type or meaning "because it's internal" — nothing reachable over HTTP is internal.
