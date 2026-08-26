#!/usr/bin/env bash
# tests/test_system_verify.sh — regression test for system-verify's Code
# Health section: `health_json=$("$health_tool" --json 2>/dev/null) ||
# health_json=""` used to clobber a perfectly valid JSON capture with an
# empty string whenever code-health exited nonzero -- which it deliberately
# does on every run that finds any issues at all (the normal case). The
# result was "code-health returned no output" masking real findings on
# effectively every run.
#
# Runs the real tools end-to-end (matches tests/test_tools.sh's existing
# smoke-test convention) rather than re-implementing the logic in
# isolation, since system-verify's Code Health section is inline script,
# not a sourceable function.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== system-verify Code Health regression test ==="

health_tool="${REPO_ROOT}/tools/code-health"
verify_tool="${REPO_ROOT}/tools/system-verify"

if [[ ! -x "$health_tool" ]]; then
    echo "SKIP: tools/code-health not found/executable"
    exit 0
fi

# Ground truth, straight from code-health itself.
health_json=$("$health_tool" --json 2>/dev/null)
health_exit=$?
health_issues=$(echo "$health_json" | jq -r '.issues // 0' 2>/dev/null)

echo ""
echo "Test 1: code-health itself produces valid JSON regardless of exit code"
if [[ -n "$health_json" ]] && echo "$health_json" | jq -e . >/dev/null 2>&1; then
    pass "code-health --json produced valid JSON (exit=${health_exit}, issues=${health_issues})"
else
    fail "code-health --json produced no valid JSON (exit=${health_exit})"
fi

echo ""
echo "Test 2: system-verify's Code Health section reflects that JSON, not 'no output'"
verify_output=$("$verify_tool" 2>&1)
# "Code Health" is printed with a bold ANSI prefix (not at column 0), so
# match on the bare substring rather than anchoring to line start.
code_health_line=$(echo "$verify_output" | grep -A1 "Code Health" | tail -1)

if echo "$code_health_line" | grep -qi "returned no output"; then
    fail "system-verify reported 'no output' despite code-health producing valid JSON -- got: ${code_health_line}"
else
    pass "system-verify did not report the false 'no output' failure"
fi

# The most direct regression check: if code-health found real issues,
# system-verify's line must say so (not mask it as clean or no-output).
if ((health_issues > 0)); then
    if echo "$code_health_line" | grep -q "${health_issues} issue(s)"; then
        pass "system-verify's issue count (${health_issues}) matches code-health's real count exactly"
    else
        fail "expected system-verify to report ${health_issues} issue(s), got: ${code_health_line}"
    fi
elif ((health_issues == 0)); then
    if echo "$code_health_line" | grep -qi "clean"; then
        pass "code-health is clean (0 issues) and system-verify correctly reports that"
    else
        fail "expected 'code health clean', got: ${code_health_line}"
    fi
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
