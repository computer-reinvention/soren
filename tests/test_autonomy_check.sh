#!/usr/bin/env bash
# tests/test_autonomy_check.sh — regression tests for the backlog section of
# tools/autonomy-check: pending-approval proposals must never be reported
# as claimable, drive "Highest priority: ... claim with ..." text, or be
# the sole reason a heartbeat nudge fires (has_findings) in supervised mode
# (the default) — they're unclaimable by any agent until a human runs
# `./tools/backlog approve`, so nudging about them every idle cycle was a
# loop only a human could break.
#
# Fully isolated: builds a throwaway sqlite DB (SOREN_DB override) rather
# than touching the real .soren/soren.db.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

TEST_DB="$(mktemp -t autonomy-check-test-XXXXXX.db)"
trap 'rm -f "$TEST_DB"' EXIT

sqlite3 "$TEST_DB" <<'SQL'
CREATE TABLE tasks (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
    project TEXT DEFAULT '', assigned_to TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', priority TEXT DEFAULT 'medium',
    source TEXT DEFAULT 'system', parent_id TEXT DEFAULT '',
    resources TEXT DEFAULT '[]', created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, completed_at TEXT DEFAULT '',
    linked_workers TEXT DEFAULT '', duration_seconds INTEGER,
    remarks TEXT DEFAULT '', approved INTEGER DEFAULT 0
);
SQL

# autonomy-check resolves SOREN_PROJECT_ROOT to find its own sibling lib
# files (tools/lib/db.sh) AND as the cwd for its Git-status check, so it
# can't be pointed at an isolated throwaway directory without also
# providing that lib -- SOREN_PROJECT_ROOT is left at its real-repo
# default. SOREN_SESSION/SOREN_MAILBOX are overridden to guarantee no
# ambient tmux/mailbox state leaks in; the real repo's actual git status
# (whatever it happens to be right now) is tolerated and assertions below
# check for the presence/absence of specific backlog-related lines rather
# than a global "all clear".
run_autonomy_check() {
    SOREN_DB="$TEST_DB" SOREN_AUTONOMY="${1:-supervised}" \
        SOREN_SESSION="autonomy-check-test-no-such-session" \
        SOREN_MAILBOX="${REPO_ROOT}/.soren/mailbox-does-not-exist-for-test" \
        "${REPO_ROOT}/tools/autonomy-check" --summary 2>&1
    echo "EXIT:$?"
}

seed_task() {
    local id="$1" priority="$2" approved="$3"
    sqlite3 "$TEST_DB" "INSERT INTO tasks (id, title, status, priority, created_at, updated_at, approved) VALUES ('${id}', 'test', 'backlog', '${priority}', datetime('now'), datetime('now'), ${approved});"
}

echo "=== autonomy-check backlog approval-gating tests ==="

# Test 1: pending-approval-only backlog in supervised mode must NOT be
# claimable and must NOT drive "Highest priority" text -- it's reported
# only via the separate, informational "pending approval" line.
echo ""
echo "Test 1: pending-approval-only backlog is not claimable (supervised)"
sqlite3 "$TEST_DB" "DELETE FROM tasks;"
seed_task "t1" "critical" 0
output=$(run_autonomy_check supervised)
if echo "$output" | grep -q "^Backlog:"; then
    fail "must not report a claimable 'Backlog:' line when nothing is approved -- got:
$output"
else
    pass "no claimable 'Backlog:' line when nothing is approved"
fi
if echo "$output" | grep -q "Backlog (pending approval): 1 item(s) awaiting human approval"; then
    pass "unapproved item still surfaced informationally"
else
    fail "expected the pending-approval informational line, got:
$output"
fi
if echo "$output" | grep -qi "claim with"; then
    fail "must never suggest claiming an unapproved item -- got:
$output"
else
    pass "no 'claim with' suggestion for an unapproved item"
fi

# Test 2: approved items ARE still reported as claimable/actionable.
echo ""
echo "Test 2: approved backlog items are still claimable (supervised)"
sqlite3 "$TEST_DB" "DELETE FROM tasks;"
seed_task "t2" "critical" 1
output=$(run_autonomy_check supervised)
if echo "$output" | grep -q "Backlog: 1 items" && echo "$output" | grep -q "claim with ./tools/backlog next" && echo "$output" | grep -q "EXIT:0"; then
    pass "approved critical item reported as claimable, nudge fires"
else
    fail "expected claimable critical item to be reported, got:
$output"
fi

# Test 3: a mix of approved + pending-approval reports both, separately --
# the approved one drives the priority line, the pending one is
# informational-only (never phrased as actionable).
echo ""
echo "Test 3: mixed approved + pending-approval reported separately"
sqlite3 "$TEST_DB" "DELETE FROM tasks;"
seed_task "t3a" "high" 1
seed_task "t3b" "critical" 0
output=$(run_autonomy_check supervised)
if echo "$output" | grep -q "Backlog: 1 items (1 high)" && echo "$output" | grep -q "Backlog (pending approval): 1 item(s) awaiting human approval"; then
    pass "approved and pending-approval counts reported separately"
else
    fail "expected separate approved/pending-approval lines, got:
$output"
fi
# The critical item is unapproved -- the approved high-priority one must
# drive "Highest priority", not a phantom "claim the critical one" line.
if echo "$output" | grep -q "Highest priority:.*high-priority item"; then
    pass "highest_priority reflects the approved item, not the unapproved critical one"
else
    fail "expected highest_priority to reference the approved high item, got:
$output"
fi

# Test 4: in autonomous mode, approval no longer matters -- unapproved
# items are claimable and reported exactly as before.
echo ""
echo "Test 4: autonomous mode ignores the approval gate entirely"
sqlite3 "$TEST_DB" "DELETE FROM tasks;"
seed_task "t4" "critical" 0
output=$(run_autonomy_check autonomous)
if echo "$output" | grep -q "Backlog: 1 items (1 critical)" && echo "$output" | grep -q "claim with ./tools/backlog next" && ! echo "$output" | grep -q "pending approval"; then
    pass "autonomous mode treats the unapproved item as claimable, no pending-approval noise"
else
    fail "expected autonomous mode to ignore approval gating, got:
$output"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
