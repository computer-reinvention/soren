#!/usr/bin/env bash
# tests/test_log_watcher.sh — unit tests for log-watcher.sh's error-block
# extraction (the fix for alerts that used to capture only the bare
# "Traceback (most recent call last):" header line and none of the actual
# stack frames / exception message that make an alert useful).
#
# Sources log-watcher.sh directly (its main() is guarded against running
# when sourced) rather than spinning up the real daemon.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${REPO_ROOT}/src/orchestrator/log-watcher.sh"
# log-watcher.sh's own `set -euo pipefail` leaks into this shell since
# sourcing runs in the same process — undo the `-e` part specifically, or
# any assertion below that legitimately returns nonzero (e.g. a failing
# grep used for a PASS/FAIL check) would silently kill this whole script
# instead of just failing that one check.
set +e

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

error_regex=$(IFS='|'; echo "${ERROR_PATTERNS[*]}")
ignore_regex=$(IFS='|'; echo "${IGNORE_PATTERNS[*]}")

collect_blocks() {
    # Reads content on stdin, prints each extracted block prefixed by
    # "---BLOCK---" so the test assertions below can split on it reliably
    # regardless of embedded newlines.
    local content
    content=$(cat)
    while IFS= read -r -d '' block; do
        echo "---BLOCK---"
        printf '%s\n' "$block"
    done < <(extract_error_blocks "$content" "$error_regex" "$ignore_regex")
}

echo "=== log-watcher.sh error-block extraction tests ==="

# Test 1: a full traceback (header + indented frames + exception summary)
# must be captured as ONE block containing every line, not just the header.
echo ""
echo "Test 1: full traceback captured with all frames + summary"
input='INFO:     something routine
ERROR:    Exception in ASGI application
Traceback (most recent call last):
  File "/app/main.py", line 10, in handler
    await do_thing()
  File "/app/other.py", line 20, in do_thing
    raise ValueError("boom")
ValueError: boom
INFO:     back to normal'
output=$(printf '%s' "$input" | collect_blocks)
block_count=$(echo "$output" | grep -c '^---BLOCK---')
if [[ "$block_count" -eq 2 ]]; then
    pass "two blocks found (the ASGI header line + the traceback block)"
else
    fail "expected 2 blocks, got $block_count -- output:
$output"
fi
if echo "$output" | grep -q 'File "/app/other.py"' && echo "$output" | grep -q 'ValueError: boom'; then
    pass "traceback block includes stack frames and the exception summary line"
else
    fail "traceback block is missing frames or summary -- output:
$output"
fi

# Test 2: a plain single-line error (no Traceback) stays single-line.
echo ""
echo "Test 2: plain ERROR line stays single-line"
input='ERROR:    something went wrong, no traceback here
INFO:     fine'
output=$(printf '%s' "$input" | collect_blocks)
if [[ "$(echo "$output" | grep -c '^---BLOCK---')" -eq 1 ]] && echo "$output" | grep -q 'something went wrong'; then
    pass "plain ERROR line captured as a single-line block"
else
    fail "unexpected output for plain ERROR line:
$output"
fi

# Test 3: ignored lines (matching IGNORE_PATTERNS) are never captured.
echo ""
echo "Test 3: ignored lines are not captured"
input='INFO:     GET /api/webhooks/health 200 OK
2026-01-01T00:00:00 | FAILED | soren:a -> soren:b | window not found'
output=$(printf '%s' "$input" | collect_blocks)
if [[ -z "$output" ]]; then
    pass "ignored lines produced zero blocks"
else
    fail "ignored lines leaked into output:
$output"
fi

# Test 4: a traceback with no trailing non-indented summary line within
# this poll's content (still "capturing" at EOF) is flushed, not dropped.
echo ""
echo "Test 4: traceback still open at EOF is flushed, not dropped"
input='Traceback (most recent call last):
  File "/app/main.py", line 1, in x
    pass'
output=$(printf '%s' "$input" | collect_blocks)
if echo "$output" | grep -q 'File "/app/main.py"'; then
    pass "mid-capture traceback at EOF was flushed"
else
    fail "mid-capture traceback at EOF was dropped:
$output"
fi

# Test 5: two independent tracebacks in the same content are two blocks.
echo ""
echo "Test 5: two separate tracebacks yield two distinct blocks"
input='Traceback (most recent call last):
  File "/a.py", line 1, in f
FirstError: one
INFO:     unrelated
Traceback (most recent call last):
  File "/b.py", line 2, in g
SecondError: two'
output=$(printf '%s' "$input" | collect_blocks)
if echo "$output" | grep -q 'FirstError: one' && echo "$output" | grep -q 'SecondError: two'; then
    pass "both tracebacks captured independently"
else
    fail "expected both tracebacks present:
$output"
fi

# Test 6: a pathological run of indented lines is bounded, not unbounded.
echo ""
echo "Test 6: capture is bounded by TRACEBACK_MAX_LINES"
input="Traceback (most recent call last):"
for _ in $(seq 1 100); do
    input="${input}
  some indented line"
done
output=$(printf '%s' "$input" | collect_blocks)
captured_lines=$(echo "$output" | grep -c '  some indented line')
if ((captured_lines <= TRACEBACK_MAX_LINES)); then
    pass "capture bounded at $captured_lines lines (max $TRACEBACK_MAX_LINES)"
else
    fail "capture grew unbounded: $captured_lines lines (max $TRACEBACK_MAX_LINES)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
