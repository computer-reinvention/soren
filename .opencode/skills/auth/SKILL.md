---
name: auth
description: Manage SOREN dashboard user accounts (human logins to the web UI), not agent identities. Use when the human asks to add, remove, or list dashboard users.
---

# Auth - Dashboard User Accounts

This manages **human** accounts that log into the web dashboard — completely separate from agent identity (`SOREN_AGENT_NAME`, the `agents` table) and from the secrets vault (`secrets` skill). Don't confuse the two.

## Commands

```bash
./tools/auth add-user <username> [password]   # password auto-generated if omitted — capture the output
./tools/auth remove-user <username>
./tools/auth list-users
```

## Notes

- If you omit the password on `add-user`, one is generated and printed once — there's no way to retrieve it again after, only reset by re-running `add-user` (or a dedicated reset path if one exists) since it's stored hashed.
- This is a human-administration action, not something a worker does mid-task. Only reach for this when explicitly asked to manage dashboard access.
- Dashboard sessions are JWT-based (see `soren_token` cookie / `Authorization: Bearer` header) — this tool manages the underlying user records the login endpoint checks against.
