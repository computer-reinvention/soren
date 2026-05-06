#!/usr/bin/env bash
#===============================================================================
# filelock.sh - Portable file locking for cross-process coordination
#
# Provides locking via flock(2) system call.
# Works on both Linux (flock command) and macOS (python3 fcntl fallback).
#
# Mailbox lock: mailbox_lock() / mailbox_unlock()
#   All writers to .soren/mailbox MUST use these to prevent JSONL corruption.
#
# Tmux send lock: tmux_send_lock(window) / tmux_send_unlock()
#   All scripts that send-keys to agent tmux windows SHOULD use these to
#   prevent interleaved input (router.sh, journal-nudge.sh, compact.sh).
#
# Usage:
#   source "path/to/lib/filelock.sh"
#   mailbox_lock; echo '{"json":"line"}' >> "$SOREN_MAILBOX"; mailbox_unlock
#   tmux_send_lock "worker-1"; tmux send-keys ...; tmux_send_unlock
#===============================================================================

SOREN_MAILBOX_LOCKFILE="${SOREN_PROJECT_ROOT:-.}/.soren/run/mailbox.lock"
mkdir -p "$(dirname "$SOREN_MAILBOX_LOCKFILE")" 2>/dev/null || true
_SOREN_LOCK_FD=9

mailbox_lock() {
    # Open lock file on fd 9
    eval "exec ${_SOREN_LOCK_FD}>\"${SOREN_MAILBOX_LOCKFILE}\""

    if command -v flock &>/dev/null; then
        # Linux: use flock command directly
        flock -x ${_SOREN_LOCK_FD}
    else
        # macOS: use Python's fcntl (same flock(2) syscall, cross-process compatible)
        python3 -c "import fcntl; fcntl.flock(${_SOREN_LOCK_FD}, fcntl.LOCK_EX)"
    fi
}

mailbox_unlock() {
    # Closing the fd releases the flock
    eval "exec ${_SOREN_LOCK_FD}>&-"
}

#-------------------------------------------------------------------------------
# Per-window tmux send locking
# Prevents router, journal-nudge, and compact from interleaving send-keys
#-------------------------------------------------------------------------------

_SOREN_TMX_LOCK_FD=8

tmux_send_lock() {
    local window="$1"
    local lockfile="${SOREN_PROJECT_ROOT:-.}/.soren/run/tmux-send-${window}.lock"

    eval "exec ${_SOREN_TMX_LOCK_FD}>\"${lockfile}\""

    if command -v flock &>/dev/null; then
        flock -x ${_SOREN_TMX_LOCK_FD}
    else
        python3 -c "import fcntl; fcntl.flock(${_SOREN_TMX_LOCK_FD}, fcntl.LOCK_EX)"
    fi
}

tmux_send_unlock() {
    eval "exec ${_SOREN_TMX_LOCK_FD}>&-"
}

#-------------------------------------------------------------------------------
# Resource locking for parallel worker coordination
# Prevents two workers from editing the same file simultaneously.
# Uses a named lock derived from the resource path.
#
# Usage:
#   resource_lock "src/server/routes/agents.py"
#   # ... edit the file ...
#   resource_unlock
#
# Or with timeout (non-blocking, returns 1 if lock not acquired):
#   resource_trylock "src/server/routes/agents.py" 5   # 5 second timeout
#-------------------------------------------------------------------------------

_SOREN_RES_LOCK_FD=7
_SOREN_RES_LOCKDIR="${SOREN_PROJECT_ROOT:-.}/.soren/run/resource-locks"

_resource_lockfile() {
    local resource="$1"
    mkdir -p "$_SOREN_RES_LOCKDIR"
    # Hash the resource path to get a safe filename
    local hash
    hash=$(echo -n "$resource" | md5sum 2>/dev/null | cut -d' ' -f1 || echo -n "$resource" | md5 2>/dev/null)
    echo "${_SOREN_RES_LOCKDIR}/${hash}.lock"
}

resource_lock() {
    local resource="$1"
    local lockfile
    lockfile=$(_resource_lockfile "$resource")

    # Write the resource path and holder into the lockfile for debugging
    eval "exec ${_SOREN_RES_LOCK_FD}>\"${lockfile}\""

    if command -v flock &>/dev/null; then
        flock -x ${_SOREN_RES_LOCK_FD}
    else
        python3 -c "import fcntl; fcntl.flock(${_SOREN_RES_LOCK_FD}, fcntl.LOCK_EX)"
    fi

    # Record holder info for debugging
    echo "${SOREN_AGENT_NAME:-unknown} $(date +%s) $resource" >&${_SOREN_RES_LOCK_FD}
}

resource_trylock() {
    local resource="$1"
    local timeout="${2:-0}"
    local lockfile
    lockfile=$(_resource_lockfile "$resource")

    eval "exec ${_SOREN_RES_LOCK_FD}>\"${lockfile}\""

    if command -v flock &>/dev/null; then
        if ((timeout > 0)); then
            flock -x -w "$timeout" ${_SOREN_RES_LOCK_FD}
        else
            flock -x -n ${_SOREN_RES_LOCK_FD}
        fi
    else
        python3 -c "
import fcntl, time, sys
timeout = $timeout
start = time.time()
while True:
    try:
        fcntl.flock(${_SOREN_RES_LOCK_FD}, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if timeout == 0 or time.time() - start >= timeout:
            sys.exit(1)
        time.sleep(0.1)
"
    fi
}

resource_unlock() {
    eval "exec ${_SOREN_RES_LOCK_FD}>&-"
}
