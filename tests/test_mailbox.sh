#!/usr/bin/env bash
# tests/test_mailbox.sh — regression tests for tools/mailbox's `update`
# subcommand: it used to accept ANY string as a message id with zero
# validation, silently writing a dangling status_update record that
# matched no real message (autonomy-check then kept counting the target
# as permanently unread). Now it resolves exact/unambiguous-prefix ids
# against real messages and rejects unknown/ambiguous ones outright.
#
# Fully isolated: uses a temp mailbox file (SOREN_MAILBOX override), never
# the real .soren/mailbox.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEST_MAILBOX="$(mktemp -t mailbox-test-XXXXXX.jsonl)"
rm -f "$TEST_MAILBOX"  # ensure_mailbox recreates it; start from "doesn't exist"
export SOREN_MAILBOX="$TEST_MAILBOX"
export SOREN_AGENT_NAME="test-agent"
export SOREN_PORT="1"  # nothing listens here — the best-effort API PATCH must no-op, not hang/fail loudly

# shellcheck source=/dev/null
source "${REPO_ROOT}/tools/mailbox"
set +e  # tools/mailbox's own `set -euo pipefail` leaks into this shell on source

trap 'rm -f "$TEST_MAILBOX"' EXIT

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== tools/mailbox update id-resolution tests ==="

# Seed two real messages plus one status_update record referencing the
# first (status_updates must not themselves count as resolvable "messages").
FULL_ID_1="11111111-aaaa-4444-8888-000000000001"
FULL_ID_2="22222222-bbbb-4444-8888-000000000002"
cat > "$TEST_MAILBOX" <<EOF
{"id":"${FULL_ID_1}","ts":"2026-01-01T00:00:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"first task","status":"submitted"}
{"id":"${FULL_ID_2}","ts":"2026-01-01T00:01:00+00:00","from":"soren:worker-a","to":"soren:supervisor","subject":"second task","status":"submitted"}
{"type":"status_update","id":"${FULL_ID_1}","ts":"2026-01-01T00:02:00+00:00","from":"soren:worker-a","status":"working"}
EOF

# Test 1: exact full id resolves to itself.
echo ""
echo "Test 1: exact full id resolves"
resolved=$(resolve_message_id "$FULL_ID_1" 2>&1)
if [[ "$resolved" == "$FULL_ID_1" ]]; then
    pass "exact id resolved correctly"
else
    fail "expected $FULL_ID_1, got: $resolved"
fi

# Test 2: unambiguous 8-char prefix resolves.
echo ""
echo "Test 2: unambiguous prefix resolves"
prefix="${FULL_ID_2:0:8}"
resolved=$(resolve_message_id "$prefix" 2>&1)
if [[ "$resolved" == "$FULL_ID_2" ]]; then
    pass "unambiguous prefix '${prefix}' resolved to full id"
else
    fail "expected $FULL_ID_2, got: $resolved"
fi

# Test 3: unknown id is rejected outright (the core bug -- this used to
# silently succeed and write a dangling record).
echo ""
echo "Test 3: unknown id is rejected, not silently written"
if output=$(resolve_message_id "deadbeef-does-not-exist" 2>&1); then
    fail "expected resolve_message_id to fail for an unknown id, got: $output"
else
    pass "unknown id rejected: $output"
fi
before_lines=$(wc -l < "$TEST_MAILBOX" | tr -d ' ')
if output=$(cmd_update "deadbeef-does-not-exist" "working" 2>&1); then
    fail "expected cmd_update to fail (die) for an unknown id, got: $output"
else
    pass "cmd_update rejected the unknown id: $output"
fi
after_lines=$(wc -l < "$TEST_MAILBOX" | tr -d ' ')
if [[ "$before_lines" == "$after_lines" ]]; then
    pass "no dangling record written for the rejected id ($before_lines lines before and after)"
else
    fail "mailbox grew from $before_lines to $after_lines lines despite the rejected update"
fi

# Test 4: a status_update record's id is not itself a resolvable message
# (only real send/quick messages, which have a "subject" key, count).
echo ""
echo "Test 4: a bare status_update record is not a resolvable message on its own"
: > "$TEST_MAILBOX"
echo '{"type":"status_update","id":"33333333-cccc-4444-8888-000000000003","ts":"2026-01-01T00:00:00+00:00","from":"soren:x","status":"working"}' > "$TEST_MAILBOX"
if output=$(resolve_message_id "33333333" 2>&1); then
    fail "a status_update-only id must not resolve as a message, got: $output"
else
    pass "status_update-only id correctly not resolvable: $output"
fi

# Test 5: ambiguous prefix (matches 2+ real messages) is rejected.
echo ""
echo "Test 5: ambiguous prefix is rejected"
cat > "$TEST_MAILBOX" <<EOF
{"id":"aaaaaaaa-1111-4444-8888-000000000001","ts":"2026-01-01T00:00:00+00:00","from":"x","to":"y","subject":"one","status":"submitted"}
{"id":"aaaaaaaa-2222-4444-8888-000000000002","ts":"2026-01-01T00:01:00+00:00","from":"x","to":"y","subject":"two","status":"submitted"}
EOF
if output=$(resolve_message_id "aaaaaaaa" 2>&1); then
    fail "expected ambiguous-prefix rejection, got: $output"
else
    if echo "$output" | grep -qi "ambiguous"; then
        pass "ambiguous prefix correctly rejected: $output"
    else
        fail "rejected but wrong reason: $output"
    fi
fi

# Test 6: a successful update on a real, unambiguous id writes exactly one
# new status_update line referencing the FULL resolved id (not whatever
# partial string was originally typed).
echo ""
echo "Test 6: successful update writes one status_update line with the full id"
cat > "$TEST_MAILBOX" <<EOF
{"id":"${FULL_ID_1}","ts":"2026-01-01T00:00:00+00:00","from":"x","to":"y","subject":"first task","status":"submitted"}
EOF
prefix="${FULL_ID_1:0:8}"
cmd_update "$prefix" "working" >/dev/null 2>&1
new_line=$(tail -1 "$TEST_MAILBOX")
written_id=$(echo "$new_line" | jq -r '.id')
written_type=$(echo "$new_line" | jq -r '.type')
written_status=$(echo "$new_line" | jq -r '.status')
if [[ "$written_id" == "$FULL_ID_1" && "$written_type" == "status_update" && "$written_status" == "working" ]]; then
    pass "status_update written with full id, correct type/status"
else
    fail "unexpected record written: $new_line"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
