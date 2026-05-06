#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SOREN JOURNAL NUDGE DAEMON
#
# Periodically checks agent activity in SQLite and nudges agents to journal
# when they've accumulated enough tool calls since their last journal entry.
#
# Runs independently of the Python backend — if the server dies, this daemon
# keeps running and will nudge agents once they're active again.
#═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/tmux.sh"
source "${SCRIPT_DIR}/lib/logging.sh"

SOREN_SESSION="${SOREN_SESSION:-soren}"
SOREN_PROJECT_ROOT="${SOREN_PROJECT_ROOT:-$(pwd)}"
DB_PATH="${SOREN_PROJECT_ROOT}/.soren/conversations.db"

# Thresholds
TOOL_THRESHOLD=60                # nudge after this many tool calls (base, overridden by role)
CHECK_INTERVAL=60                # seconds between checks
MIN_NUDGE_INTERVAL=900           # minimum seconds between nudges for same agent (15 min)

# Role-based threshold scaling — supervisors and research agents do more reads
get_threshold_for_agent() {
    local agent_id="$1"
    case "$agent_id" in
        supervisor|sup-*)         echo 120 ;;
        perm-research|*-research) echo 60 ;;
        *-clone-*)                echo 100 ;;
        *)                        echo "$TOOL_THRESHOLD" ;;
    esac
}

# Check if agent has used mutation tools (Bash/Write/Edit) recently — skip read-only agents
has_mutation_tools() {
    local agent_id="$1"
    local since
    since=$(date -u -v-${MIN_NUDGE_INTERVAL}S +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || \
            date -u -d "${MIN_NUDGE_INTERVAL} seconds ago" +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || \
            echo "2000-01-01T00:00:00")
    local count
    count=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        SELECT COUNT(*) FROM agent_events
        WHERE agent_id = '${agent_id}'
          AND event_type = 'PostToolUse'
          AND tool_name IN ('Bash', 'Write', 'Edit', 'NotebookEdit')
          AND timestamp > '${since}';" 2>/dev/null | tail -1 || echo "0")
    [[ "$count" -gt 0 ]]
}

# Track last nudge time per agent using parallel arrays (bash 3.x compatible)
NUDGE_AGENT_IDS=()
NUDGE_AGENT_TIMES=()

nudge_message() {
    cat <<'MSG'
[SYSTEM AUTO-JOURNAL REMINDER — NOT A USER MESSAGE. DO NOT RESPOND TO THIS. DO NOT ACKNOWLEDGE THIS. Just silently run the command below if you've done meaningful work since your last entry, then continue your current task without any interruption. Skip if you've only been reading/exploring.]
./tools/journal note "<short title>" "<1-2 sentences: what was done, why, key decisions or findings>"
MSG
}

# Count unlinked tool call events per agent (events without a message_id = work since last Stop)
get_agent_tool_counts() {
    if [[ ! -f "$DB_PATH" ]]; then
        return
    fi

    sqlite3 "$DB_PATH" <<'SQL' 2>/dev/null | grep '|'
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=5000;
        SELECT agent_id, COUNT(*) as cnt
        FROM agent_events
        WHERE event_type = 'PostToolUse'
          AND message_id IS NULL
        GROUP BY agent_id
        HAVING cnt > 0;
SQL
}

# Count tool calls since last journal entry for agents who DO have linked events
# (i.e. agents actively producing messages but not journaling)
get_agent_total_recent() {
    if [[ ! -f "$DB_PATH" ]]; then
        return
    fi

    # Count events in the last MIN_NUDGE_INTERVAL seconds
    local since
    since=$(date -u -v-${MIN_NUDGE_INTERVAL}S +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || \
            date -u -d "${MIN_NUDGE_INTERVAL} seconds ago" +"%Y-%m-%dT%H:%M:%S" 2>/dev/null || \
            echo "2000-01-01T00:00:00")

    sqlite3 "$DB_PATH" <<SQL 2>/dev/null | grep '|'
        PRAGMA journal_mode=WAL;
        PRAGMA busy_timeout=5000;
        SELECT agent_id, COUNT(*) as cnt
        FROM agent_events
        WHERE event_type = 'PostToolUse'
          AND timestamp > '${since}'
        GROUP BY agent_id
        HAVING cnt >= ${TOOL_THRESHOLD};
SQL
}

_get_last_nudge() {
    local agent_id="$1"
    local i
    for ((i=0; i<${#NUDGE_AGENT_IDS[@]}; i++)); do
        if [[ "${NUDGE_AGENT_IDS[$i]}" == "$agent_id" ]]; then
            echo "${NUDGE_AGENT_TIMES[$i]}"
            return
        fi
    done
    echo "0"
}

_set_last_nudge() {
    local agent_id="$1"
    local ts="$2"
    local i
    for ((i=0; i<${#NUDGE_AGENT_IDS[@]}; i++)); do
        if [[ "${NUDGE_AGENT_IDS[$i]}" == "$agent_id" ]]; then
            NUDGE_AGENT_TIMES[$i]="$ts"
            return
        fi
    done
    NUDGE_AGENT_IDS+=("$agent_id")
    NUDGE_AGENT_TIMES+=("$ts")
}

should_nudge() {
    local agent_id="$1"
    local now
    now=$(date +%s)

    local last
    last=$(_get_last_nudge "$agent_id")
    local elapsed=$((now - last))

    if ((elapsed < MIN_NUDGE_INTERVAL)); then
        return 1  # Too soon
    fi

    return 0
}

send_nudge() {
    local agent_id="$1"

    local msg
    msg=$(nudge_message)

    # Find which session this agent lives in
    # First check the main session
    if tmux_window_exists "$SOREN_SESSION" "$agent_id"; then
        local send_rc=0
        tmux_safe_send "$SOREN_SESSION" "$agent_id" "$msg" --retry 1 --queue || send_rc=$?
        if ((send_rc == 0 || send_rc == 2)); then
            _set_last_nudge "$agent_id" "$(date +%s)"
            log_info "Journal nudge sent to ${agent_id} (rc=${send_rc})"
            return 0
        fi
        return 1
    fi

    # Check spawned sessions (soren-*)
    local sessions
    sessions=$(tmux list-sessions -F "#{session_name}" 2>/dev/null | grep "^soren-" || true)
    for session in $sessions; do
        if tmux_window_exists "$session" "$agent_id"; then
            local send_rc=0
            tmux_safe_send "$session" "$agent_id" "$msg" --retry 1 --queue || send_rc=$?
            if ((send_rc == 0 || send_rc == 2)); then
                _set_last_nudge "$agent_id" "$(date +%s)"
                log_info "Journal nudge sent to ${agent_id} in session ${session} (rc=${send_rc})"
                return 0
            fi
            return 1
        fi
    done

    return 1  # Agent window not found
}

main() {
    log_info "Journal nudge daemon started (threshold: ${TOOL_THRESHOLD} tools, interval: ${MIN_NUDGE_INTERVAL}s)"
    log_status "DAEMON" "Journal nudge daemon started (PID: $$, threshold: ${TOOL_THRESHOLD})"

    while true; do
        # Method 1: Check unlinked events (agent is mid-work, hasn't stopped yet)
        while IFS='|' read -r agent_id count; do
            [[ -z "$agent_id" ]] && continue
            local threshold
            threshold=$(get_threshold_for_agent "$agent_id")
            if ((count >= threshold)) && should_nudge "$agent_id" && has_mutation_tools "$agent_id"; then
                send_nudge "$agent_id" || true
            fi
        done < <(get_agent_tool_counts 2>/dev/null || true)

        # Method 2: Check total recent events (agent may have stopped but not journaled)
        while IFS='|' read -r agent_id count; do
            [[ -z "$agent_id" ]] && continue
            local threshold
            threshold=$(get_threshold_for_agent "$agent_id")
            if ((count >= threshold)) && should_nudge "$agent_id" && has_mutation_tools "$agent_id"; then
                send_nudge "$agent_id" || true
            fi
        done < <(get_agent_total_recent 2>/dev/null || true)

        sleep "$CHECK_INTERVAL"
    done
}

main
