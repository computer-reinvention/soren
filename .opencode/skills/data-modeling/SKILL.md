---
name: data-modeling
description: Design database schemas with sound normalization tradeoffs, SQLite-specific judgment, and safe migrations. Load before creating or altering tables.
---

# Data Modeling

Schema mistakes outlive code mistakes. Code you refactor in an afternoon; a bad schema follows you through every migration.

## Schema Design Principles

- Model the *facts*, not the screens. UI shapes change weekly; the truth of "a task has one assignee and many events" changes rarely.
- Every table gets: a primary key, `created_at`, and (if rows mutate) `updated_at`. You will want them the first time you debug.
- Prefer TEXT enums with a CHECK constraint over magic integers: `status TEXT CHECK(status IN ('pending','running','done'))` is self-documenting.
- Store timestamps in UTC ISO-8601 (or unix epoch). Never local time — SOREN learned this the hard way with token expiry.
- NULL means "unknown/absent", not "false" or "empty". If you're branching on NULL vs empty-string, the model is wrong.

## Normalization Tradeoffs

- Normalize by default: one fact, one place. Duplicated data *will* diverge.
- Denormalize deliberately, not accidentally — acceptable when: read-heavy hot path, the duplicate is derivable and rebuildable, and you own the single write path that maintains it.
- JSON columns (SQLite `json()`) are fine for genuinely schemaless payloads (event data, external webhooks). They are NOT fine for fields you filter or join on — promote those to real columns.
- If you can't state the query that needs the denormalization, don't denormalize.

## SQLite Specifics

- One writer at a time. Use WAL mode (`PRAGMA journal_mode=WAL`) for concurrent readers during writes; expect `SQLITE_BUSY` and set `busy_timeout`.
- Column types are affinities, not enforcement — SQLite will happily store `"banana"` in an INTEGER column unless you use STRICT tables or CHECK constraints.
- Foreign keys are OFF by default: `PRAGMA foreign_keys=ON` per connection, or your cascades silently don't exist.
- `INSERT OR REPLACE` deletes-then-inserts (fires triggers, resets defaults); prefer `INSERT ... ON CONFLICT ... DO UPDATE` (upsert) when you mean update.
- Index what you filter/join/sort on; verify with `EXPLAIN QUERY PLAN`. Don't index low-cardinality columns alone.

## Migrations

- Migrations are append-only, forward-only scripts. Never edit a migration that has run anywhere.
- Every migration answers: what happens to *existing rows*? New NOT NULL columns need a DEFAULT or a backfill step.
- SQLite `ALTER TABLE` is limited (no DROP COLUMN before 3.35, no ALTER COLUMN). The standard recipe: create new table → copy data → drop old → rename. Wrap in a transaction.
- Test the migration against a copy of real data, not an empty database — empty databases hide every backfill bug.
- Additive first: add the new column, dual-write, backfill, switch reads, then drop the old column in a later migration.

## Checklist Before Shipping a Schema Change

1. Primary key, timestamps, and constraints (NOT NULL, CHECK, FK) declared.
2. Existing rows accounted for (default/backfill).
3. Indexes match the actual queries; `EXPLAIN QUERY PLAN` checked for the hot path.
4. Rollback story exists — can the previous code version still read this schema?
5. Migration tested on populated data.

## Anti-Patterns

- Entity-Attribute-Value tables ("flexible schema") — you've reinvented a worse database.
- Comma-separated lists in a TEXT column — that's a join table crying for help.
- Soft-delete flags without filtering discipline — every query must remember `WHERE deleted = 0`; consider a separate archive table instead.
- Storing derived values with no rebuild path.
- Renaming columns in place across a deploy boundary — old code + new schema = downtime.
