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

# Log a status message (for status.log)
log_status() {
    _ensure_log_dir
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
