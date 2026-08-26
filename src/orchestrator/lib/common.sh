#!/usr/bin/env bash
# Common functions and variables for soren orchestrator

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get project root (where script is run from or SOREN_PROJECT_ROOT)
get_project_root() {
    echo "${SOREN_PROJECT_ROOT:-$(pwd)}"
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Ensure required commands are available
ensure_dependencies() {
    local deps=("tmux" "curl" "git" "uv" "npm")
    local missing=()

    for dep in "${deps[@]}"; do
        if ! command_exists "$dep"; then
            missing+=("$dep")
        fi
    done

    if ((${#missing[@]} > 0)); then
        echo -e "${RED}Missing dependencies: ${missing[*]}${NC}"
        exit 1
    fi
}

# Generate a unique ID
generate_id() {
    date +%s%N | sha256sum | head -c 12
}

# run_with_timeout <seconds> <cmd> [args...]
#
# Portable stand-in for GNU coreutils' `timeout` — which macOS does not
# ship (and doesn't provide as `gtimeout` unless `brew install coreutils`
# was run). Runs $cmd, killing it if it's still alive after $seconds.
#
# This was a real, silent bug: monitor.sh's periodic system-verify check
# called `timeout 10 "$syscheck_tool"` directly. On a machine with neither
# `timeout` nor `gtimeout` installed, that line fails with
# "command not found" (exit 127) *before ever running system-verify at
# all* -- and monitor.sh's failure-parsing branch (`grep -c '✗'` over the
# captured output) found zero ✗ characters in "command not found: timeout"
# and logged a false "0 check(s) failed", forever. All 9 categories of
# infra verification (hooks, daemons, health, DB integrity, tmux, context
# freshness, code health, lesson freshness, role contracts) were silently
# never actually run on any machine without those binaries installed.
#
# Prefers the real `timeout`/`gtimeout` when present (identical semantics,
# zero overhead); only falls back to the manual background-and-kill
# implementation when neither exists.
run_with_timeout() {
    local secs="$1"; shift
    if command -v timeout &>/dev/null; then
        timeout "$secs" "$@"
        return $?
    elif command -v gtimeout &>/dev/null; then
        gtimeout "$secs" "$@"
        return $?
    fi

    # Manual fallback: race the real command against a watchdog that
    # kills it after $secs. stdout/stderr are inherited normally (not
    # redirected through a temp file), so `out=$(run_with_timeout ...)`
    # captures them exactly like the real `timeout` would.
    "$@" &
    local cmd_pid=$!
    (
        sleep "$secs"
        kill -TERM "$cmd_pid" 2>/dev/null
    ) &
    local watchdog_pid=$!

    local exit_code
    if wait "$cmd_pid" 2>/dev/null; then
        exit_code=0
    else
        exit_code=$?
    fi
    kill "$watchdog_pid" 2>/dev/null
    wait "$watchdog_pid" 2>/dev/null
    return "$exit_code"
}
