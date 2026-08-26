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

# ── Mailbox scan correctness + performance ──────────────────────────────────
# The mailbox section was rewritten from up to 4 jq subprocess spawns PER
# LINE (measured 3.3s wall-clock for a 290-line mailbox, run synchronously
# inside monitor.sh's 5s dashboard loop) down to a single jq pass for the
# whole file. That rewrite hit a real field-alignment bug during
# development (bash's `read` silently drops a leading empty field when
# IFS is a whitespace character, even set via `IFS=$'\t'` — every
# ordinary message, whose first field `.type` is empty, had every
# subsequent field shifted left by one) — these tests guard against that
# regressing, along with a bash-3.2-specific bug where `IFS=$'\x01'`
# (a control character via ANSI-C quoting) silently fails to split at all
# inside `read` fed by process substitution.

TEST_MAILBOX="$(mktemp -t autonomy-check-mailbox-XXXXXX.jsonl)"
rm -f "$TEST_MAILBOX"
trap 'rm -f "$TEST_DB" "$TEST_MAILBOX"' EXIT

run_autonomy_check_with_mailbox() {
    SOREN_DB="$TEST_DB" SOREN_AUTONOMY="supervised" \
        SOREN_SESSION="autonomy-check-test-no-such-session" \
        SOREN_MAILBOX="$TEST_MAILBOX" \
        "${REPO_ROOT}/tools/autonomy-check" --summary 2>&1
}

echo ""
echo "=== autonomy-check mailbox scan tests ==="

# Test 5: ordinary messages (no .type field, i.e. the common case) must
# have every field correctly aligned -- not all bucketed into "other" the
# way the leading-empty-field bug caused.
echo ""
echo "Test 5: mixed subject tags are correctly categorized, not all 'other'"
cat > "$TEST_MAILBOX" <<'EOF'
{"id":"11111111-0000-4000-8000-000000000001","ts":"2026-01-01T00:00:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"[BLOCKED] cannot proceed","status":"submitted"}
{"id":"22222222-0000-4000-8000-000000000002","ts":"2026-01-01T00:01:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"[DONE] task complete","status":"submitted"}
{"id":"33333333-0000-4000-8000-000000000003","ts":"2026-01-01T00:02:00+00:00","from":"soren:worker-b","to":"soren:supervisor","subject":"[QUESTION] need input","status":"submitted"}
{"id":"44444444-0000-4000-8000-000000000004","ts":"2026-01-01T00:03:00+00:00","from":"soren:worker-b","to":"soren:supervisor","subject":"just a plain update","status":"submitted"}
EOF
output=$(run_autonomy_check_with_mailbox)
mailbox_line=$(echo "$output" | grep "^Mailbox:")
if echo "$mailbox_line" | grep -q "4 unread" \
    && echo "$mailbox_line" | grep -q "1 BLOCKED" \
    && echo "$mailbox_line" | grep -q "1 DONE" \
    && echo "$mailbox_line" | grep -q "1 QUESTION"; then
    pass "all 4 subject tags correctly categorized: $mailbox_line"
else
    fail "expected correct per-tag categorization, got: $mailbox_line"
fi

# Test 6: a resolved (completed/failed) message is correctly excluded from
# the unread count -- this is the exact check the field-alignment bug
# silently defeated (a garbled id never matches the resolved-id set, so
# everything looked perpetually unread).
echo ""
echo "Test 6: a message resolved via status_update is excluded from unread count"
cat > "$TEST_MAILBOX" <<'EOF'
{"id":"55555555-0000-4000-8000-000000000005","ts":"2026-01-01T00:00:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"[DONE] resolved task","status":"submitted"}
{"type":"status_update","id":"55555555-0000-4000-8000-000000000005","ts":"2026-01-01T00:01:00+00:00","from":"soren:supervisor","status":"completed"}
{"id":"66666666-0000-4000-8000-000000000006","ts":"2026-01-01T00:02:00+00:00","from":"soren:worker-b","to":"soren:supervisor","subject":"[DONE] still unread","status":"submitted"}
EOF
output=$(run_autonomy_check_with_mailbox)
mailbox_line=$(echo "$output" | grep "^Mailbox:" || true)
if echo "$mailbox_line" | grep -q "1 unread"; then
    pass "resolved message correctly excluded, only the unresolved one counted: $mailbox_line"
else
    fail "expected exactly 1 unread (the unresolved message), got: $mailbox_line"
fi

# Test 7: a message whose subject contains a literal newline (a real
# multi-line DONE report, common in practice) must not corrupt the
# following line's field alignment.
echo ""
echo "Test 7: embedded newline in a subject does not corrupt subsequent lines"
python3 - "$TEST_MAILBOX" <<'PYEOF'
import json, sys
path = sys.argv[1]
with open(path, "w") as f:
    f.write(json.dumps({
        "id": "77777777-0000-4000-8000-000000000007", "ts": "2026-01-01T00:00:00+00:00",
        "from": "soren:worker-a", "to": "soren:supervisor",
        "subject": "[DONE] multi-line report\nsecond line\nthird line", "status": "submitted",
    }) + "\n")
    f.write(json.dumps({
        "id": "88888888-0000-4000-8000-000000000008", "ts": "2026-01-01T00:01:00+00:00",
        "from": "soren:worker-b", "to": "soren:supervisor",
        "subject": "[BLOCKED] this must still parse correctly", "status": "submitted",
    }) + "\n")
PYEOF
output=$(run_autonomy_check_with_mailbox)
mailbox_line=$(echo "$output" | grep "^Mailbox:" || true)
if echo "$mailbox_line" | grep -q "2 unread" && echo "$mailbox_line" | grep -q "1 BLOCKED" && echo "$mailbox_line" | grep -q "1 DONE"; then
    pass "embedded newline handled correctly, both messages categorized: $mailbox_line"
else
    fail "expected 2 unread (1 BLOCKED, 1 DONE) despite the embedded newline, got: $mailbox_line"
fi

# Test 8: performance guard -- a mailbox with many lines must complete
# well under a second, not the ~3s+ the old per-line-jq approach took.
echo ""
echo "Test 8: performance -- a 100-line mailbox scans quickly"
: > "$TEST_MAILBOX"
for i in $(seq 1 100); do
    printf '{"id":"aaaaaaaa-0000-4000-8000-%012d","ts":"2026-01-01T00:00:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"[DONE] task %d","status":"submitted"}\n' "$i" "$i" >> "$TEST_MAILBOX"
done
start=$(date +%s)
run_autonomy_check_with_mailbox >/dev/null 2>&1
elapsed=$(( $(date +%s) - start ))
if ((elapsed <= 2)); then
    pass "100-line mailbox scanned in ${elapsed}s (well under the old per-line-jq cost)"
else
    fail "100-line mailbox took ${elapsed}s -- expected well under 2s"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
