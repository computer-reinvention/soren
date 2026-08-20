---
name: security-review
description: Review code for input validation gaps, authn/authz confusion, injection classes, and secrets mishandling. Load before reviewing any endpoint, form handler, subprocess call, or auth change.
---

# Security Review

Assume every input is hostile and every mistake is reachable. Security review is systematic pessimism applied at the boundaries.

## Input Validation

- Validate at the **trust boundary** (the route handler / message consumer), not deep inside. By the time data reaches business logic it must already be typed, bounded, and shaped.
- Allowlist beats blocklist: define what IS valid (`^[a-z0-9-]{1,64}$`) instead of stripping known-bad characters. Blocklists always miss one.
- Validate: type, length, range, format, AND semantics (does this agent ID exist? does this path stay inside the sandbox?).
- Reject, don't sanitize-and-continue, when input is malformed — silently "fixing" input hides attacks and bugs alike.
- Pydantic/schema validation returning 422 is the pattern; hand-rolled `if` chains drift out of sync with reality.

## AuthN vs AuthZ (the classic confusion)

- **Authentication**: who are you? **Authorization**: are YOU allowed to do THIS to THAT?
- The most common real-world hole is missing *object-level* authz (IDOR): endpoint checks the user is logged in, then serves `/api/documents/12345` without checking *ownership*. Check authz on every object access, not just at login.
- Authz checks live server-side, per-request. Hiding a button in the UI is not access control.
- Fail closed: no session → 401; valid session but no permission → 403; and don't leak existence (404 vs 403 consistency for private resources).

## Injection Classes (one disease, many symptoms)

All injection is the same bug: **data concatenated into a language** (SQL, shell, HTML, JS, path, JSON).

- **SQL**: parameterized queries, always: `cursor.execute("... WHERE id = ?", (id,))`. String-formatting a query is a finding, full stop.
- **Shell**: never interpolate user input into `bash -c` / `subprocess(shell=True)` / tmux `send-keys`. Use arg arrays; SOREN's tmux layer is a prime audit target — a crafted message body must not become keystrokes.
- **Path traversal**: any user-supplied path gets resolved (`realpath`) and checked against the allowed root *after* resolution. `../` and symlinks defeat prefix string checks.
- **XSS**: frameworks escape by default — audit every escape hatch: `dangerouslySetInnerHTML`, `innerHTML`, `v-html`, unescaped template filters.
- **SSRF**: user-supplied URLs fetched server-side must be scheme/host-allowlisted; block internal ranges (169.254.x, 127.x, 10.x).

## Secrets Handling

- Secrets come from env vars or the encrypted secret store (`tools/secrets`, backed by the `secrets_vault` table in `.soren/soren.db`) — never literals in code, config committed to git, or CLI args (visible in `ps`).
- Never log secrets: audit log lines, error messages, and exception traces that echo request bodies/headers.
- If a secret ever touched git history, it's burned — rotate it; deleting the file doesn't help.
- Tokens: compare with constant-time comparison; expire them; scope them minimally.

## Review Checklist

1. Every new/changed endpoint: input validated (type+length+format), 401/403 paths exist and are tested.
2. Every DB query: parameterized. Every subprocess: arg-array, no shell interpolation of external data.
3. Every file path from outside: resolved and containment-checked.
4. Every fetch of a user-supplied URL: allowlisted.
5. Grep the diff for secrets, and for secrets reaching logs.
6. Error responses leak nothing internal (traces, SQL, paths).

## Anti-Patterns

- "It's an internal tool" — internal tools get exposed, proxied, and screenshared.
- Security by obscurity (unguessable URLs as the only access control).
- Validating on the client only.
- Catch-all exception handlers that return the exception message to the caller.
- Rolling your own crypto, sessions, or password hashing — use the boring standard library/framework mechanism.
