#!/usr/bin/env bash
#===============================================================================
# sandbox_verify_latch_flow.sh — end-to-end sandbox suite for the verify-done
# retry/latch pipeline after the file→table migration (fix_retries +
# verify_events in .soren/soren.db).
#
# Mirrors the pre-migration multi-check latch-flow suite: drives the REAL
# .opencode/hooks/verify-done.sh, tools/verifications, and tools/workers send
# against a throwaway sandbox (SOREN_HOME + SOREN_DB point at a mktemp dir;
# mailbox is a stub; tmux/server are never touched — the live .soren/ is
# never read or written).
#
# Flow covered: 2 retries → escalation row → latched skip → workers-send
# clears → cycle resumes; plus skip paths, VERIFIED path, legacy-dir import,
# concurrent-DONE race, and verifications table reads.
#
# Usage: bash tests/sandbox_verify_latch_flow.sh
#===============================================================================

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO_ROOT/.opencode/hooks/verify-done.sh"

#-------------------------------------------------------------------------------
# Sandbox setup
#-------------------------------------------------------------------------------
SBX="$(mktemp -d /tmp/soren-verify-sbx.XXXXXX)"
trap 'rm -rf "$SBX"' EXIT

mkdir -p "$SBX/.soren" "$SBX/tools"
ln -s "$REPO_ROOT/tools/lib" "$SBX/tools/lib"
ln -s "$REPO_ROOT/tools/workers" "$SBX/tools/workers"
ln -s "$REPO_ROOT/tools/verifications" "$SBX/tools/verifications"

# Stub mailbox: records every call
cat > "$SBX/tools/mailbox" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$(dirname "$0")/../.soren/mailbox-stub.log"
EOF
chmod +x "$SBX/tools/mailbox"

# Sandbox git repo (for the VERIFIED path)
git -C "$SBX" init -q
git -C "$SBX" config user.email t@t
git -C "$SBX" config user.name t
echo hello > "$SBX/README.txt"
git -C "$SBX" add README.txt
git -C "$SBX" commit -qm "docs: readme"
COMMIT_SHA=$(git -C "$SBX" rev-parse --short=8 HEAD)

export SOREN_AGENT=true
export SOREN_AGENT_NAME=test-agent
export SOREN_SUPERVISOR=supervisor
export SOREN_HOME="$SBX"
export SOREN_DB="$SBX/.soren/soren.db"
export SOREN_PORT=59999                     # dead port — hook curls fail fast
export SOREN_PROJECT_ID=soren
export SOREN_SESSION="soren-sbx-$$"         # nonexistent tmux session

MAILLOG="$SBX/.soren/mailbox-stub.log"
DB="$SOREN_DB"

#-------------------------------------------------------------------------------
# Harness
#-------------------------------------------------------------------------------
PASS=0
FAIL=0
N=0

check() {
    local desc="$1"; shift
    N=$((N + 1))
    if "$@" >/dev/null 2>&1; then
        printf 'CHECK %2d: PASS — %s\n' "$N" "$desc"
        PASS=$((PASS + 1))
    else
        printf 'CHECK %2d: FAIL — %s\n' "$N" "$desc"
        FAIL=$((FAIL + 1))
    fi
}

q() { sqlite3 -cmd '.timeout 5000' "$DB" "$1" 2>/dev/null; }

# fire_done [agent] <message> — invoke the hook exactly as the plugin does
fire_done() {
    local agent="$SOREN_AGENT_NAME" msg
    if [[ $# -eq 2 ]]; then agent="$1"; shift; fi
    msg="$1"
    printf '{"tool_name":"Bash","tool_input":{"command":"./tools/mailbox done %s"}}' "'$msg'" \
        | (cd "$SBX" && SOREN_AGENT_NAME="$agent" bash "$HOOK")
}

# wait_sql <sql> <expected> — poll until the query returns the expected value
wait_sql() {
    local sql="$1" expected="$2" i out
    for i in $(seq 1 50); do
        out=$(q "$sql")
        [[ "$out" == "$expected" ]] && return 0
        sleep 0.2
    done
    echo "wait_sql timeout: [$sql] => [$out] (wanted [$expected])" >&2
    return 1
}

grep_mail() { grep -q "$1" "$MAILLOG" 2>/dev/null; }

echo "=== verify-done latch flow sandbox — $SBX ==="
echo "=== db: $DB ==="
echo ""

MSG="work complete but there is no commit reported"

#-------------------------------------------------------------------------------
# Phase 0: hook trigger guards
#-------------------------------------------------------------------------------
printf '{"tool_name":"Read","tool_input":{}}' | (cd "$SBX" && bash "$HOOK")
check "hook ignores non-Bash tool events (exit 0, no state)" \
    test ! -f "$DB"

printf '{"tool_name":"Bash","tool_input":{"command":"ls -la"}}' | (cd "$SBX" && bash "$HOOK")
check "hook ignores non-mailbox-done bash commands" \
    test ! -f "$DB"

#-------------------------------------------------------------------------------
# Phase 1: two retries
#-------------------------------------------------------------------------------
fire_done "$MSG"
check "DONE #1 (missing commit): retry counter = 1" \
    wait_sql "SELECT retries FROM fix_retries WHERE agent='test-agent';" "1"
check "DONE #1: FIX-REQUEST event row written" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='FIX-REQUEST';" "1"
check "DONE #1: worker mailed [FIX-REQUEST] attempt 1/2" \
    grep_mail "\[FIX-REQUEST\] missing-commit: attempt 1/2"

fire_done "$MSG"
check "DONE #2: retry counter = 2 (same task key)" \
    wait_sql "SELECT retries FROM fix_retries WHERE agent='test-agent';" "2"
check "DONE #2: worker mailed [FIX-REQUEST] attempt 2/2" \
    grep_mail "\[FIX-REQUEST\] missing-commit: attempt 2/2"
check "retry state visible in 'verifications pending'" \
    bash -c "cd '$SBX' && ./tools/verifications pending | grep -q 'test-agent.*2/2'"

#-------------------------------------------------------------------------------
# Phase 2: escalation
#-------------------------------------------------------------------------------
fire_done "$MSG"
check "DONE #3: escalated — VERIFY-FAILED event row written" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='VERIFY-FAILED';" "1"
check "DONE #3: latch set (escalated=1), counter reset to 0" \
    wait_sql "SELECT retries || '/' || escalated FROM fix_retries WHERE agent='test-agent';" "0/1"
check "DONE #3: supervisor mailed [VERIFY-FAILED]" \
    grep_mail "\[VERIFY-FAILED\] test-agent"
check "latch visible in 'verifications latches'" \
    bash -c "cd '$SBX' && ./tools/verifications latches | grep -q 'test-agent'"
check "'verifications pending' empty while latched (retries=0)" \
    bash -c "cd '$SBX' && ./tools/verifications pending | grep -q 'nothing pending'"

#-------------------------------------------------------------------------------
# Phase 3: latched skip
#-------------------------------------------------------------------------------
fire_done "$MSG"
check "DONE #4 while latched: LATCHED event, NO new FIX-REQUEST" \
    wait_sql "SELECT (SELECT COUNT(*) FROM verify_events WHERE event='LATCHED') || '/' ||
              (SELECT COUNT(*) FROM verify_events WHERE event='FIX-REQUEST');" "1/2"
check "DONE #4: latch + zero counter unchanged" \
    wait_sql "SELECT retries || '/' || escalated FROM fix_retries WHERE agent='test-agent';" "0/1"

#-------------------------------------------------------------------------------
# Phase 4: supervisor dispatch clears the latch (tools/workers send)
#-------------------------------------------------------------------------------
# The send fails later ("worker not found" — no tmux worker in the sandbox)
# but the latch clear happens FIRST; that DB effect is what we assert.
(cd "$SBX" && ./tools/workers send test-agent "new dispatch") >/dev/null 2>&1
check "workers send cleared the escalation latch (escalated=0)" \
    wait_sql "SELECT escalated FROM fix_retries WHERE agent='test-agent';" "0"
check "no latches listed after workers send" \
    bash -c "cd '$SBX' && ./tools/verifications latches | grep -q 'No escalation latches'"

#-------------------------------------------------------------------------------
# Phase 5: cycle resumes
#-------------------------------------------------------------------------------
fire_done "$MSG"
check "DONE #5 after unlatch: FIX-REQUEST cycle resumes (counter = 1)" \
    wait_sql "SELECT retries FROM fix_retries WHERE agent='test-agent';" "1"
check "DONE #5: third FIX-REQUEST event row" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='FIX-REQUEST';" "3"

#-------------------------------------------------------------------------------
# Phase 6: clean completions clear state + skip paths write events
#-------------------------------------------------------------------------------
fire_done "done, committed $COMMIT_SHA — added readme"
check "VERIFIED (real commit): event row with commit sha" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='VERIFIED' AND commit_sha='$COMMIT_SHA';" "1"
check "VERIFIED: supervisor mailed [VERIFIED]" \
    grep_mail "\[VERIFIED\] test-agent: commit $COMMIT_SHA"

fire_done "no-op: verification-only task, nothing changed"
check "no-op DONE: SKIP-NOOP event row" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='SKIP-NOOP';" "1"

fire_done "res-research-1" "findings: the answer is 42"
check "research DONE: SKIP-RESEARCH event row" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='SKIP-RESEARCH';" "1"

mkdir -p "$SBX/.soren/run"
printf '{"exempt-agent":{"done_requires_commit":false}}' > "$SBX/.soren/run/contracts.json"
fire_done "exempt-agent" "shipped the thing without a commit"
check "contract-exempt DONE: SKIP-CONTRACT-EXEMPT event row" \
    wait_sql "SELECT COUNT(*) FROM verify_events WHERE event='SKIP-CONTRACT-EXEMPT';" "1"

#-------------------------------------------------------------------------------
# Phase 7: cross-cutting invariants
#-------------------------------------------------------------------------------
check "status.log [VERIFY] lines still written alongside table rows" \
    bash -c "grep -c ' | \[VERIFY\] | ' '$SBX/.soren/status.log' | grep -qv '^0$'"
check "'verifications recent' reads the table (shows LATCHED outcome)" \
    bash -c "cd '$SBX' && ./tools/verifications recent 50 | grep -q 'LATCHED'"

# Concurrent-DONE race: two hooks for a FRESH task key must both count
CMSG="parallel job lacks a commit hash entirely"
fire_done "$CMSG" & fire_done "$CMSG" & wait
check "concurrent DONEs: both increments land (retries = 2, no lost update)" \
    wait_sql "SELECT retries FROM fix_retries WHERE agent='test-agent' AND retries=2;" "2"

# Legacy dir import (lazy, on a verifications invocation)
mkdir -p "$SBX/.soren/.fix-retries"
echo 1 > "$SBX/.soren/.fix-retries/legacy-agent-deadbee1"
touch "$SBX/.soren/.fix-retries/legacy-agent-deadbee1.escalated"
(cd "$SBX" && ./tools/verifications latches) >/dev/null 2>&1
check "legacy .fix-retries dir imported into the table" \
    wait_sql "SELECT retries || '/' || escalated FROM fix_retries WHERE agent='legacy-agent' AND task_key='deadbee1';" "1/1"
check "legacy dir renamed to .fix-retries.migrated" \
    test -d "$SBX/.soren/.fix-retries.migrated" -a ! -d "$SBX/.soren/.fix-retries"

echo ""
echo "=== event rows written ==="
q "SELECT event, COUNT(*) FROM verify_events GROUP BY event ORDER BY event;" | sed 's/^/    /'
echo ""
echo "=== RESULT: $PASS/$N passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]]