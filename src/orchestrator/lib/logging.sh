#!/usr/bin/env bash
# Logging utilities for soren orchestrator
#
# All log functions write to BOTH console AND a persistent orchestrator log.
# This ensures diagnostic info survives terminal repaints, crashes, and restarts.

SOREN_STATUS_LOG="${SOREN_STATUS_LOG:-.soren/status.log}"
SOREN_IMPL_LOG="${SOREN_IMPL_LOG:-.soren/implementation.log}"
SOREN_ORCH_LOG="${SOREN_ORCH_LOG:-.soren/orchestrator.log}"

# Ensure log directory exists
_ensure_log_dir() {
    mkdir -p "$(dirname "$SOREN_STATUS_LOG")" 2>/dev/null || true
    mkdir -p "$(dirname "$SOREN_IMPL_LOG")" 2>/dev/null || true
    mkdir -p "$(dirname "$SOREN_ORCH_LOG")" 2>/dev/null || true
}

# Persist a line to the orchestrator log (no console output)
_orch_log() {
    _ensure_log_dir
    _maybe_check_log_rotation
    echo "$(date -Iseconds) $*" >> "$SOREN_ORCH_LOG" 2>/dev/null || true
}

# Rotate orchestrator log if it exceeds ~2MB
_maybe_rotate_orch_log() {
    if [[ -f "$SOREN_ORCH_LOG" ]]; then
        local size
        size=$(stat --format=%s "$SOREN_ORCH_LOG" 2>/dev/null || stat -f %z "$SOREN_ORCH_LOG" 2>/dev/null || echo 0)
        if (( size > 2097152 )); then
            mv "$SOREN_ORCH_LOG" "${SOREN_ORCH_LOG}.1" 2>/dev/null || true
        fi
    fi
}

# Rotate status log if it exceeds ~2MB. This log had NO rotation at all
# before — measured at 2.0MB / 20,124 lines, 84% of which turned out to
# be the exact same "system-verify: 0 check(s) failed" line repeated
# every 15s (see run_with_timeout's fix in common.sh: system-verify was
# silently never executing at all on this machine, and that false
# all-clear message happened to contain none of the '✗' characters the
# failure-count parser looks for). That root cause is fixed, but this
# log still had no ceiling of its own — mirrors _maybe_rotate_orch_log.
_maybe_rotate_status_log() {
    if [[ -f "$SOREN_STATUS_LOG" ]]; then
        local size
        size=$(stat --format=%s "$SOREN_STATUS_LOG" 2>/dev/null || stat -f %z "$SOREN_STATUS_LOG" 2>/dev/null || echo 0)
        if (( size > 2097152 )); then
            mv "$SOREN_STATUS_LOG" "${SOREN_STATUS_LOG}.1" 2>/dev/null || true
        fi
    fi
}

# Both rotation checks used to only ever run once, at monitor.sh's own
# startup (_maybe_rotate_orch_log was never called from anywhere else) —
# a long-lived monitor process (uptimes of multiple days are normal here)
# could grow either log arbitrarily far past its own 2MB threshold within
# a single run, with nothing re-checking until the next restart. Sampled
# every 100 log calls instead of on every single one, to bound the
# rotation check's own stat() overhead rather than paying it on every
# log_info/log_status call.
_log_rotation_check_counter=0
_maybe_check_log_rotation() {
    _log_rotation_check_counter=$((_log_rotation_check_counter + 1))
    if (( _log_rotation_check_counter % 100 == 0 )); then
        _maybe_rotate_orch_log
        _maybe_rotate_status_log
    fi
}

# Log a status message (for status.log)
log_status() {
    _ensure_log_dir
    _maybe_check_log_rotation
    local status="$1"
    shift
    local message="$*"
    local line="$(date -Iseconds) [${status}] ${message}"
    echo "$line" >> "$SOREN_STATUS_LOG"
    echo "$line" >> "$SOREN_ORCH_LOG" 2>/dev/null || true
}

# Log an implementation detail (for implementation.log)
log_impl() {
    _ensure_log_dir
    local message="$*"
    echo "$(date -Iseconds) ${message}" >> "$SOREN_IMPL_LOG"
}

# Log to stdout with color AND persist to orchestrator log
log_info() {
    echo -e "${BLUE:-}[INFO]${NC:-} $*"
    _orch_log "[INFO] $*"
}

log_warn() {
    echo -e "${YELLOW:-}[WARN]${NC:-} $*"
    _orch_log "[WARN] $*"
}

log_error() {
    echo -e "${RED:-}[ERROR]${NC:-} $*"
    _orch_log "[ERROR] $*"
}

log_success() {
    echo -e "${GREEN:-}[OK]${NC:-} $*"
    _orch_log "[OK] $*"
}
