---
name: trie-cli
description: The user's trie CLI - an artefact tree mirroring the source tree with intent tracking and a commit gate. Use in repos that contain trie.toml.
---

# trie CLI

trie maintains an artefact tree ("triefacts") that mirrors the source tree —
an in-repo index of what code means and why it changed, kept coherent by an
LSP-aware cascade. It is the user's own product; treat its conventions as
first-class in any repo containing `trie.toml`.

## Detect and orient

```bash
ls trie.toml 2>/dev/null          # trie-enabled repo?
trie status                       # like git status for the triefact tree
trie plan                         # surface drift + worklist + estimated cost
```

## The read path (prefer over raw file reads in trie repos)

```bash
trie read <path-or-symbol>        # triefact-first: synthesized description before source
trie grep <predicate>             # symbol search (mirror of the MCP grep tool)
trie trace <symbol> --depth 2     # call graph outward from a symbol
trie blast-radius <symbol>        # cascade impact of editing a symbol — check BEFORE large edits
```

## The write path (after making changes)

```bash
trie sync                         # bring graph + triefacts up to date with the working tree
trie diff                         # what changed this session, at the intent level
trie intent                       # every changed symbol must carry a patch note (its intent)
trie verify                       # offline drift check; exits 1 on drift
trie gate                         # the commit guard: lock-check + verify + intent + digest
```

**The gate is the contract**: in trie-enabled repos, commits are expected to
pass `trie gate`. Do not bypass it, do not commit with drifted triefacts —
write the intent notes; they are the whole point of the tool.

## Setup (only when asked)

```bash
trie init                         # trie.toml + .gitignore + symbol graph (+ optional pre-commit hook)
trie setup                        # wire trie into an agent: hooks + tool overrides (+ MCP)
trie lock-check                   # another trie process holding the write lock?
```

## Anti-patterns

- Editing triefact files by hand (they're generated; `trie sync` owns them).
- Committing in a trie repo without running `trie gate`.
- Ignoring `blast-radius` before wide refactors — it's free graph math.
- Running two trie processes concurrently (respect `lock-check`).
