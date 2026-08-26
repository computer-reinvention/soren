#!/usr/bin/env bash
# tests/test_common_timeout.sh — regression test for run_with_timeout()
# (src/orchestrator/lib/common.sh), the portable stand-in for GNU
# coreutils' `timeout`, which macOS does not ship by default.
#
# This was a critical, silent bug: monitor.sh's periodic system-verify
# check called `timeout 10 "$syscheck_tool"` directly. On any machine
# without `timeout`/`gtimeout` installed, that line fails with
# "command not found" *before system-verify ever runs*, and the
# failure-parsing branch found zero "✗" characters in the error text and
# logged a false "0 check(s) failed" -- meaning all 9 categories of infra
# verification silently never ran, forever, on such a machine.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${REPO_ROOT}/src/orchestrator/lib/common.sh"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== run_with_timeout tests ==="
if command -v timeout &>/dev/null || command -v gtimeout &>/dev/null; then
    echo "(real timeout/gtimeout is available on this machine -- exercising the delegation path)"
else
    echo "(no timeout/gtimeout on this machine -- exercising the manual fallback path, the exact scenario that was broken)"
fi

# Test 1: a fast, successful command completes normally and its output is
# captured exactly like the real `timeout` would.
echo ""
echo "Test 1: fast successful command — output captured, exit 0"
output=$(run_with_timeout 5 echo "hello world")
rc=$?
if [[ "$output" == "hello world" && $rc -eq 0 ]]; then
    pass "output and exit code correct for a fast command"
else
    fail "expected 'hello world'/0, got '$output'/$rc"
fi

# Test 2: a command that fails on its own (not a timeout) propagates its
# real exit code, not a timeout-specific one.
echo ""
echo "Test 2: fast failing command propagates its real exit code"
run_with_timeout 5 bash -c "exit 7"
rc=$?
if [[ $rc -eq 7 ]]; then
    pass "exit code 7 propagated correctly"
else
    fail "expected exit 7, got $rc"
fi

# Test 3: a command that runs longer than the timeout gets killed and
# reports failure (nonzero) -- this is the core regression: the original
# bug meant system-verify never even started, silently reported as
# success. A hung command must be treated as failure, not silently
# swallowed as "0 checks failed".
echo ""
echo "Test 3: a hung command is killed and reported as failed"
start=$(date +%s)
if run_with_timeout 1 sleep 10; then
    fail "expected the hung command to fail (be killed), but it reported success"
else
    elapsed=$(( $(date +%s) - start ))
    if ((elapsed < 5)); then
        pass "hung command was killed promptly (${elapsed}s, well under its own 10s sleep)"
    else
        fail "command was eventually killed but took ${elapsed}s -- watchdog not working promptly"
    fi
fi

# Test 4: the exact failure-parsing pattern monitor.sh uses must not
# regress -- a genuinely-failing check's stderr must be captured so
# `grep -c '✗'` (or any other parser) can see it, not swallowed.
echo ""
echo "Test 4: stderr is captured through 2>&1 exactly like real timeout"
captured=$(run_with_timeout 5 bash -c 'echo "real finding: ✗ something failed" >&2' 2>&1)
if echo "$captured" | grep -q '✗'; then
    pass "stderr output correctly captured and visible to a downstream parser"
else
    fail "expected captured output to contain the real failure marker, got: $captured"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
