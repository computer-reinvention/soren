#!/usr/bin/env bash
# tests/test_journal_tool.sh — regression tests for tools/journal's scope
# auto-resolution: a team member's entries must land in that team's own
# isolated journal directory, everyone else's in the supervisor's global
# journal, and never mixed across two different teams' directories.
#
# Fully isolated: uses a temp SOREN_DB (teams table) and a temp JOURNAL_DIR
# override (set after sourcing, since tools/journal has no env override for
# it — mirrors the JOURNAL_DIR var it computes internally), never the real
# .soren/journal or .soren/soren.db.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEST_DB="$(mktemp -t journal-test-db-XXXXXX.db)"
rm -f "$TEST_DB"
TEST_JOURNAL_DIR="$(mktemp -d -t journal-test-dir-XXXXXX)"
trap 'rm -f "$TEST_DB"; rm -rf "$TEST_JOURNAL_DIR"' EXIT

export SOREN_DB="$TEST_DB"
export SOREN_HOME="$REPO_ROOT"

# shellcheck source=/dev/null
source "${REPO_ROOT}/tools/journal"
set +e  # tools/journal's own `set -euo pipefail` leaks into this shell on source

# Point at the isolated journal dir instead of the real one, now that
# sourcing has already resolved JOURNAL_DIR from the real SOREN_HOME.
JOURNAL_DIR="$TEST_JOURNAL_DIR"

# Seed a `teams` table with one team so membership lookups have something
# real to match against.
sqlite3 "$TEST_DB" "CREATE TABLE teams (prefix TEXT PRIMARY KEY, template TEXT, task TEXT, project_id TEXT, created_at TEXT, members TEXT DEFAULT '[]', permanent INTEGER DEFAULT 0);"
sqlite3 "$TEST_DB" "INSERT INTO teams (prefix, members) VALUES ('trie', '[\"trie-tech-lead\",\"trie-backend\"]');"
sqlite3 "$TEST_DB" "INSERT INTO teams (prefix, members) VALUES ('dash', '[\"dash-tech-lead\"]');"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== tools/journal scope resolution tests ==="

# Test 1: no SOREN_AGENT_NAME set -> supervisor scope.
echo ""
echo "Test 1: no agent identity resolves to supervisor scope"
unset SOREN_AGENT_NAME
resolved=$(resolve_scope_dir)
if [[ "$resolved" == "${TEST_JOURNAL_DIR}/supervisor" ]]; then
    pass "resolved to supervisor: $resolved"
else
    fail "expected supervisor scope, got: $resolved"
fi

# Test 2: an agent that IS a team member resolves to that team's scope.
echo ""
echo "Test 2: a team member resolves to their team's scope"
export SOREN_AGENT_NAME="trie-tech-lead"
resolved=$(resolve_scope_dir)
if [[ "$resolved" == "${TEST_JOURNAL_DIR}/teams/trie" ]]; then
    pass "resolved to trie's team scope: $resolved"
else
    fail "expected teams/trie, got: $resolved"
fi

# Test 3: an agent NOT on any team falls back to supervisor scope.
echo ""
echo "Test 3: a non-team agent falls back to supervisor scope"
export SOREN_AGENT_NAME="some-solo-worker"
resolved=$(resolve_scope_dir)
if [[ "$resolved" == "${TEST_JOURNAL_DIR}/supervisor" ]]; then
    pass "resolved to supervisor: $resolved"
else
    fail "expected supervisor scope, got: $resolved"
fi

# Test 4: journal log as a team member writes into that team's own file,
# not the supervisor's.
echo ""
echo "Test 4: journal log as a team member writes to the team's own journal.md"
export SOREN_AGENT_NAME="trie-tech-lead"
cmd_log "unique-trie-marker-entry" >/dev/null 2>&1
today="$(date +%Y-%m-%d)"
trie_file="${TEST_JOURNAL_DIR}/teams/trie/${today}/journal.md"
supervisor_file="${TEST_JOURNAL_DIR}/supervisor/${today}/journal.md"
if [[ -f "$trie_file" ]] && grep -q "unique-trie-marker-entry" "$trie_file"; then
    pass "entry landed in trie's own journal.md"
else
    fail "entry did not land in ${trie_file}"
fi
if [[ -f "$supervisor_file" ]] && grep -q "unique-trie-marker-entry" "$supervisor_file"; then
    fail "entry leaked into the supervisor's journal.md — team isolation broken"
else
    pass "entry did not leak into the supervisor's journal.md"
fi

# Test 5: a second team's entry never appears in the first team's file
# (cross-team isolation, not just team-vs-supervisor isolation).
echo ""
echo "Test 5: two teams' entries stay in separate files"
export SOREN_AGENT_NAME="dash-tech-lead"
cmd_log "unique-dash-marker-entry" >/dev/null 2>&1
dash_file="${TEST_JOURNAL_DIR}/teams/dash/${today}/journal.md"
if [[ -f "$dash_file" ]] && grep -q "unique-dash-marker-entry" "$dash_file"; then
    pass "dash's entry landed in dash's own journal.md"
else
    fail "dash's entry did not land in ${dash_file}"
fi
if grep -q "unique-dash-marker-entry" "$trie_file" 2>/dev/null; then
    fail "dash's entry leaked into trie's journal.md"
else
    pass "dash's entry did not leak into trie's journal.md"
fi
if grep -q "unique-trie-marker-entry" "$dash_file" 2>/dev/null; then
    fail "trie's entry leaked into dash's journal.md"
else
    pass "trie's entry did not leak into dash's journal.md"
fi

# Test 6: journal read as a team member reads that team's own scope, not
# the supervisor's (which has no entries at all in this test run).
echo ""
echo "Test 6: journal read as a team member reads their own team's journal"
export SOREN_AGENT_NAME="trie-tech-lead"
output=$(cmd_read "$today" 2>&1)
if echo "$output" | grep -q "unique-trie-marker-entry"; then
    pass "read surfaced trie's own entry"
else
    fail "read did not surface trie's entry: $output"
fi
if echo "$output" | grep -q "unique-dash-marker-entry"; then
    fail "read leaked dash's entry into trie's view"
else
    pass "read did not leak dash's entry"
fi

# Test 7: journal log as a non-team agent writes to the supervisor scope.
echo ""
echo "Test 7: journal log as a non-team agent writes to the supervisor journal"
unset SOREN_AGENT_NAME
cmd_log "unique-supervisor-marker-entry" >/dev/null 2>&1
if [[ -f "$supervisor_file" ]] && grep -q "unique-supervisor-marker-entry" "$supervisor_file"; then
    pass "entry landed in the supervisor's own journal.md"
else
    fail "entry did not land in ${supervisor_file}"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
