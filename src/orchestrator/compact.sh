#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SOREN COMPACT DAEMON
#
# Periodically compacts agent context windows to prevent agents from hitting
# their context limit and becoming unresponsive ("bricked").
#
# Every COMPACT_INTERVAL seconds, enumerates all agent tmux windows, checks if
# each agent is idle (at prompt), and sends /compact. Verifies compaction
# succeeded by capturing pane output after a delay. Skips the supervisor.
#
# Uses per-window flock to prevent races with router.sh and journal-nudge.sh.
#═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/tmux.sh"
source "${SCRIPT_DIR}/lib/logging.sh"
source "${SCRIPT_DIR}/lib/filelock.sh"

# Single-instance enforcement (portable: Linux flock / macOS python3 fcntl)
COMPACT_LOCKFILE="${SOREN_PROJECT_ROOT:-.}/.soren/run/compact.lock"
mkdir -p "$(dirname "$COMPACT_LOCKFILE")" 2>/dev/null || true
exec 201>"$COMPACT_LOCKFILE"
if command -v flock &>/dev/null; then
    flock -n 201 || { echo "[compact] Another instance is already running. Exiting." >&2; exit 0; }
else
    python3 -c "import fcntl; fcntl.flock(201, fcntl.LOCK_EX | fcntl.LOCK_NB)" 2>/dev/null || { echo "[compact] Another instance is already running. Exiting." >&2; exit 0; }
fi
echo $$ > "${SOREN_PROJECT_ROOT:-.}/.soren/run/compact.pid"

# Configuration
SOREN_SESSION="${SOREN_SESSION:-soren}"
COMPACT_INTERVAL="${SOREN_COMPACT_INTERVAL:-600}"  # 10 minutes
VERIFY_DELAY=15                                    # seconds to wait after sending /compact
SKIP_WINDOWS="monitor|supervisor"                  # windows to never compact
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PRE_COMPACT_HOOK="${PROJECT_ROOT}/.claude/hooks/pre-compact.sh"
RECOVERY_DELAY=5                                   # seconds to wait before injecting recovery message
COMPACT_TIMESTAMPS="${PROJECT_ROOT}/.soren/.compact-timestamps"
COMPACT_COOLDOWN="${SOREN_COMPACT_COOLDOWN:-1800}"  # 30 minutes minimum between compactions per agent

# Track state
RUNNING=true

#-------------------------------------------------------------------------------
# Signal handling
#-------------------------------------------------------------------------------

cleanup() {
    RUNNING=false
    log_info "Compact daemon shutting down"
    log_status "COMPACT" "Daemon stopped"
}

trap cleanup EXIT TERM HUP INT

#-------------------------------------------------------------------------------
# Agent idle detection
#-------------------------------------------------------------------------------

# Check if an agent is at prompt (idle) by checking pane state.
# Delegates to unified tmux_pane_state(). Returns 0 if idle, 1 if busy.
is_agent_idle() {
    local session="$1"
    local window="$2"
    local state
    state=$(tmux_pane_state "$session" "$window")
    [[ "$state" == "PROMPT" ]]
}

#-------------------------------------------------------------------------------
# Activity tracking — skip agents with no work since last compaction
#-------------------------------------------------------------------------------

# Get the epoch timestamp of last compaction for a window.
# Returns 0 if never compacted.
get_last_compact_time() {
    local window="$1"
    if [[ -f "$COMPACT_TIMESTAMPS" ]]; then
        local ts
        ts=$(grep "^${window}=" "$COMPACT_TIMESTAMPS" 2>/dev/null | tail -1 | cut -d= -f2)
        echo "${ts:-0}"
    else
        echo "0"
    fi
}

# Record current epoch as last compaction time for a window.
set_last_compact_time() {
    local window="$1"
    local now
    now=$(date +%s)

    # Create file if missing
    touch "$COMPACT_TIMESTAMPS"

    # Remove old entry (if any) and append new one
    if grep -q "^${window}=" "$COMPACT_TIMESTAMPS" 2>/dev/null; then
        # Use a temp file to avoid sed -i portability issues
        grep -v "^${window}=" "$COMPACT_TIMESTAMPS" > "${COMPACT_TIMESTAMPS}.tmp" || true
        mv "${COMPACT_TIMESTAMPS}.tmp" "$COMPACT_TIMESTAMPS"
    fi
    echo "${window}=${now}" >> "$COMPACT_TIMESTAMPS"
}

# Check whether an agent has had activity since its last compaction.
# Looks at heartbeat file mtime, then falls back to context file mtime.
# Returns 0 if there IS activity (should compact), 1 if no activity (skip).
has_activity_since_last_compact() {
    local window="$1"
    local last_compact
    last_compact=$(get_last_compact_time "$window")

    # Never compacted before — always compact
    if [[ "$last_compact" == "0" ]]; then
        return 0
    fi

    # Cooldown: skip if compacted less than COMPACT_COOLDOWN seconds ago
    # This prevents the compact → recovery → heartbeat → compact loop
    local now
    now=$(date +%s)
    local elapsed=$(( now - last_compact ))
    if (( elapsed < COMPACT_COOLDOWN )); then
        log_status "COMPACT" "Skipping ${window}: cooldown (${elapsed}s/${COMPACT_COOLDOWN}s since last compaction)"
        return 1
    fi

    # Check heartbeat file first
    local heartbeat_file="${PROJECT_ROOT}/.soren/.${window}-heartbeat"
    if [[ -f "$heartbeat_file" ]]; then
        local hb_mtime
        hb_mtime=$(stat -c %Y "$heartbeat_file" 2>/dev/null || stat -f %m "$heartbeat_file" 2>/dev/null || echo 0)
        if (( hb_mtime > last_compact )); then
            return 0
        fi
    fi

    # Fall back to context file
    local context_file="${PROJECT_ROOT}/.soren/worker-contexts/${window}-context.md"
    if [[ -f "$context_file" ]]; then
        local ctx_mtime
        ctx_mtime=$(stat -c %Y "$context_file" 2>/dev/null || stat -f %m "$context_file" 2>/dev/null || echo 0)
        if (( ctx_mtime > last_compact )); then
            return 0
        fi
    fi

    # No activity detected
    return 1
}

#-------------------------------------------------------------------------------
# Compaction
#-------------------------------------------------------------------------------

# Send /compact to an agent and verify it worked.
# Returns 0 on success, 1 on failure.
compact_agent() {
    local session="$1"
    local window="$2"

    # --- Pre-compaction: capture agent state ---
    local artifact_file=""
    if [[ -x "$PRE_COMPACT_HOOK" ]]; then
        artifact_file=$("$PRE_COMPACT_HOOK" "$window" 2>/dev/null) || {
            log_status "COMPACT" "WARN: Pre-compact hook failed for ${window}, continuing anyway"
            artifact_file=""
        }
        if [[ -n "$artifact_file" ]]; then
            log_status "COMPACT" "Pre-compact state saved: ${artifact_file}"
        fi
    fi

    # Send /compact command via safe send with retries
    if ! tmux_safe_send "$session" "$window" "/compact" --retry 5; then
        log_status "COMPACT" "Skipped ${window}: agent not at prompt after retries"
        return 1
    fi

    log_status "COMPACT" "Sent /compact to ${window}, waiting ${VERIFY_DELAY}s for verification"

    # Wait for compaction to complete
    sleep "$VERIFY_DELAY"

    # Verify compaction happened by checking pane output
    local pane_output
    local compaction_ok=false
    pane_output=$(tmux_capture_pane "$session" "$window" 30 2>/dev/null) || {
        log_status "COMPACT" "WARN: Could not capture pane for ${window} verification"
        return 1
    }

    # Look for compaction success indicators
    if echo "$pane_output" | grep -qiE 'compact(ed|ion)|context.*reduc|summariz'; then
        log_status "COMPACT" "Verified: ${window} compaction succeeded"
        compaction_ok=true
    elif is_agent_idle "$session" "$window"; then
        # Agent is back at prompt (compaction may have happened but output scrolled)
        log_status "COMPACT" "OK: ${window} back at prompt after /compact (output not captured)"
        compaction_ok=true
    fi

    # --- Post-compaction: inject recovery message ---
    if $compaction_ok; then
        sleep "$RECOVERY_DELAY"

        local today
        today=$(date +%Y-%m-%d)
        local recovery_msg="You were just compacted. Read your recovery context from .soren/journal/${today}/artifacts/compaction-${window}-*.json (most recent one). Also check your conversation history via GET /api/agents/${window}/history if anything is unclear."

        if tmux_safe_send "$session" "$window" "$recovery_msg" --retry 3; then
            log_status "COMPACT" "Injected recovery message for ${window}"
        else
            log_status "COMPACT" "WARN: ${window} not idle after compaction, queuing recovery message"
            tmux_safe_send "$session" "$window" "$recovery_msg" --queue || true
        fi

        # Inject active task context after compaction
        local active_task
        active_task=$(curl -sf "http://localhost:${SOREN_PORT:-8000}/api/agents/${window}" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
task = d.get('current_task', d.get('last_task', ''))
if task: print(f'[POST-COMPACTION] You were working on: {task}')
" 2>/dev/null || true)
        if [[ -n "$active_task" ]]; then
            sleep 1
            tmux send-keys -t "${SOREN_SESSION}:${window}" -l "$active_task"
            sleep 0.1
            tmux send-keys -t "${SOREN_SESSION}:${window}" Enter
            log_status "COMPACT" "Injected active task context for ${window}"
        fi

        return 0
    fi

    log_status "COMPACT" "WARN: ${window} compaction unverified (agent may still be processing)"
    return 1
}

#-------------------------------------------------------------------------------
# Main loop
#-------------------------------------------------------------------------------

compact_all_agents() {
    # Enumerate all windows in the soren session
    local windows
    windows=$(tmux_list_windows "$SOREN_SESSION" 2>/dev/null) || {
        log_status "COMPACT" "WARN: Could not list windows (session $SOREN_SESSION not found?)"
        return
    }

    local compacted=0
    local skipped=0
    local busy=0
    local failed=0

    while IFS= read -r window; do
        [[ -z "$window" ]] && continue

        # Skip monitor and supervisor windows
        if echo "$window" | grep -qE "^(${SKIP_WINDOWS})$"; then
            ((skipped++)) || true
            continue
        fi

        # Skip agents that are not actively working per the registry.
        # Compacting an IDLE/COMPLETE/SLEEPING agent wastes tokens — they have
        # no in-progress context worth saving.
        if [[ -f "${PROJECT_ROOT}/.soren/agent_registry.json" ]]; then
            local reg_status
            reg_status=$(jq -r --arg k "$window" '.[$k].status // empty' \
                "${PROJECT_ROOT}/.soren/agent_registry.json" 2>/dev/null || true)
            if [[ "$reg_status" =~ ^(IDLE|SLEEPING|COMPLETE|FAILED)$ ]]; then
                log_status "COMPACT" "Skipping ${window}: status=${reg_status}"
                ((skipped++)) || true
                continue
            fi
        fi

        # Check if agent is idle at prompt
        if ! is_agent_idle "$SOREN_SESSION" "$window"; then
            ((busy++)) || true
            continue
        fi

        # Skip if no activity since last compaction
        if ! has_activity_since_last_compact "$window"; then
            log_status "COMPACT" "Skipping ${window}: no activity since last compaction"
            ((skipped++)) || true
            continue
        fi

        # Attempt compaction
        if compact_agent "$SOREN_SESSION" "$window"; then
            set_last_compact_time "$window"
            ((compacted++)) || true
        else
            ((failed++)) || true
        fi

    done <<< "$windows"

    log_status "COMPACT" "Cycle complete: compacted=${compacted} busy=${busy} skipped=${skipped} failed=${failed}"
}

main() {
    log_info "Compact daemon running in passive mode (event-driven compaction active)"
    log_status "COMPACT" "Passive mode — compaction triggered by server agent_events route on usage threshold"

    # Timer-based compaction is disabled. The server's agent_events route
    # (routes/agent_events.py) now triggers /compact whenever a Stop event
    # reports usage >= SOREN_COMPACT_THRESHOLD (default 80%) of the context window.
    # This daemon stays alive to handle signals and can be re-enabled if needed.
    while $RUNNING; do
        sleep 30
    done
}

main
