#!/usr/bin/env bash
# tests/test_logging_rotation.sh — regression tests for log rotation
# (src/orchestrator/lib/logging.sh).
#
# status.log had NO rotation at all (measured live at 2.0MB / 20,124
# lines) and orchestrator.log's rotation only ever ran once, at
# monitor.sh's own startup — a long-lived monitor process (multi-day
# uptimes are normal here) could grow either log arbitrarily far past its
# own 2MB threshold within a single run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TEST_DIR="$(mktemp -d -t logging-rotation-test-XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT

export SOREN_STATUS_LOG="${TEST_DIR}/status.log"
export SOREN_IMPL_LOG="${TEST_DIR}/implementation.log"
export SOREN_ORCH_LOG="${TEST_DIR}/orchestrator.log"

# shellcheck source=/dev/null
source "${REPO_ROOT}/src/orchestrator/lib/logging.sh"

PASS=0
FAIL=0
pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== log rotation tests ==="

# Test 1: a status.log over the 2MB threshold gets rotated.
echo ""
echo "Test 1: oversized status.log is rotated"
python3 -c "open('${SOREN_STATUS_LOG}', 'wb').write(b'x' * (2 * 1024 * 1024 + 1))"
_maybe_rotate_status_log
if [[ -f "${SOREN_STATUS_LOG}.1" ]] && [[ ! -f "$SOREN_STATUS_LOG" ]]; then
    pass "oversized status.log moved to status.log.1"
else
    fail "expected status.log to be rotated to status.log.1"
fi

# Test 2: a status.log under the threshold is left alone.
echo ""
echo "Test 2: small status.log is not rotated"
rm -f "${SOREN_STATUS_LOG}" "${SOREN_STATUS_LOG}.1"
echo "small content" > "$SOREN_STATUS_LOG"
_maybe_rotate_status_log
if [[ -f "$SOREN_STATUS_LOG" ]] && [[ ! -f "${SOREN_STATUS_LOG}.1" ]]; then
    pass "small status.log left in place"
else
    fail "small status.log should not have been rotated"
fi

# Test 3: same behavior for orchestrator.log.
echo ""
echo "Test 3: oversized orchestrator.log is rotated"
python3 -c "open('${SOREN_ORCH_LOG}', 'wb').write(b'x' * (2 * 1024 * 1024 + 1))"
_maybe_rotate_orch_log
if [[ -f "${SOREN_ORCH_LOG}.1" ]] && [[ ! -f "$SOREN_ORCH_LOG" ]]; then
    pass "oversized orchestrator.log moved to orchestrator.log.1"
else
    fail "expected orchestrator.log to be rotated to orchestrator.log.1"
fi

# Test 4: the periodic sampler only fires every 100 calls, not every call
# -- this bounds the added stat() overhead per log line, and is what
# makes rotation checks happen periodically during a long run rather
# than only once at startup.
echo ""
echo "Test 4: rotation check is sampled every 100 calls, not every call"
rm -f "${SOREN_ORCH_LOG}" "${SOREN_ORCH_LOG}.1" "${SOREN_STATUS_LOG}" "${SOREN_STATUS_LOG}.1"
_log_rotation_check_counter=0
python3 -c "open('${SOREN_ORCH_LOG}', 'wb').write(b'x' * (2 * 1024 * 1024 + 1))"
for _ in $(seq 1 99); do
    _maybe_check_log_rotation
done
if [[ -f "$SOREN_ORCH_LOG" ]] && [[ ! -f "${SOREN_ORCH_LOG}.1" ]]; then
    pass "not yet rotated after 99 calls (sampled every 100th)"
else
    fail "expected no rotation before the 100th call"
fi
_maybe_check_log_rotation  # the 100th call
if [[ -f "${SOREN_ORCH_LOG}.1" ]]; then
    pass "rotated on the 100th call"
else
    fail "expected rotation to fire on exactly the 100th call"
fi

# Test 5: log_status and log_info (via _orch_log) still write real
# content correctly with the rotation-check call wired in -- guards
# against the rotation hook accidentally breaking normal logging.
echo ""
echo "Test 5: normal logging still works with rotation checks wired in"
rm -f "${SOREN_STATUS_LOG}" "${SOREN_ORCH_LOG}"
log_status "TESTSTATUS" "hello world"
log_info "an info line" >/dev/null
if grep -q "TESTSTATUS.*hello world" "$SOREN_STATUS_LOG" 2>/dev/null \
    && grep -q "hello world" "$SOREN_ORCH_LOG" 2>/dev/null \
    && grep -q "an info line" "$SOREN_ORCH_LOG" 2>/dev/null; then
    pass "log_status and log_info both wrote expected content"
else
    fail "expected log content missing -- status.log: $(cat "$SOREN_STATUS_LOG" 2>/dev/null), orch.log: $(cat "$SOREN_ORCH_LOG" 2>/dev/null)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
