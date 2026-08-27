---
name: secrets
description: Store and retrieve encrypted credentials (API keys, tokens) needed during a task. Use instead of ever hardcoding a secret in code, a commit, a journal entry, or a mailbox message.
---

# Secrets - Encrypted Credential Vault

A passphrase-encrypted key/value store for credentials a task needs (API keys, tokens, webhook secrets) — never commit these to code. Backed by the `secrets_vault` table (`.soren/soren.db`), accessible via CLI or the authenticated `/api/secrets/*` endpoints.

## Commands

```bash
./tools/secrets set <KEY> <VALUE>   # encrypt and store
./tools/secrets get <KEY>           # decrypt and print
./tools/secrets list                # names only, never values
./tools/secrets delete <KEY>
```

## The Passphrase Is Always Required

Every command needs a passphrase — there is no ambient/automatic access. Resolution order:
1. `SOREN_SECRETS_PASSPHRASE` environment variable
2. Prompted interactively from `/dev/tty`

**If you're an agent process with no attached terminal and `SOREN_SECRETS_PASSPHRASE` isn't set, `get`/`set`/`list`/`delete` will hang waiting for input that will never come.** Check the env var is set before calling this — if it isn't, ask whoever spawned you (or the user) for it rather than invoking the command blind:

```bash
[[ -n "${SOREN_SECRETS_PASSPHRASE:-}" ]] || echo "no passphrase in env, ask before using tools/secrets"
```

## Security Discipline

- **Never** print a decrypted value into a journal entry, mailbox message, commit message, or `[DONE]` report
- **Never** hardcode a secret value in source code — read it into an env var at runtime (`export API_KEY=$(./tools/secrets get api-key)`) and reference the env var in code
- **Never** echo a fetched value to a log file or terminal output that gets captured elsewhere (compaction artifacts capture your last 50 terminal lines — a secret printed right before compaction ends up in that JSON file)
- `list` is safe to run freely — it only shows names, never values

## Example

```bash
# One-time setup (a human does this, since it needs the passphrase):
./tools/secrets set stripe-api-key "sk_live_..."

# A task that needs it later:
export STRIPE_KEY=$(./tools/secrets get stripe-api-key)
# ... use $STRIPE_KEY in your code/test, never print it ...
```
