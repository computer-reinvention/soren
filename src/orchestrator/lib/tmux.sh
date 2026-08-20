#!/usr/bin/env bash
# tmux helper functions for soren orchestrator

# Registry writes must go through the SQLite master (see tools/lib/opencode.sh
# — agent_registry.json is only a regenerated view). tmux.sh is sourced by
# router.sh/compact.sh/monitor.sh, which don't all source tools/lib, so pull
# in the registry helpers ourselves when they're missing. opencode.sh is a
# pure function library — sourcing it has no side effects.
if ! declare -f soren_registry_update >/dev/null 2>&1; then
    # shellcheck source=/dev/null
    source "$(dirname "${BASH_SOURCE[0]}")/../../../tools/lib/opencode.sh" 2>/dev/null || true
fi

# Check if a tmux session exists
tmux_session_exists() {
    local session="$1"
    tmux has-session -t "$session" 2>/dev/null
}

# Create a new tmux session
tmux_create_session() {
    local session="$1"
    tmux new-session -d -s "$session" -n "monitor"
}

# Check if a tmux window exists
tmux_window_exists() {
    local session="$1"
    local window="$2"
    # Use -xF for exact fixed-string match (prevents regex injection via window names)
    tmux list-windows -t "$session" -F "#{window_name}" 2>/dev/null | grep -qxF "$window"
}

# Create a new tmux window
tmux_create_window() {
    local session="$1"
    local name="$2"
    # Use session: syntax to append window without specifying index
    tmux new-window -t "${session}:" -n "$name"
}

# Send keys to a tmux window (low-level primitive)
# Delivery order:
#   1. HTTP injection via the agent's embedded opencode server (reliable,
#      immune to paste/prompt-state issues) when a port is registered.
#   2. tmux send-keys / paste-buffer fallback for plain shells or when the
#      opencode server is unreachable.
#
# Callers SHOULD use tmux_safe_send() instead — it checks pane state first.
# Only use tmux_send_keys() directly for fresh windows or when state is known.
tmux_send_keys() {
    local session="$1"
    local window="$2"
    shift 2
    local keys="$*"
    local msg_len=${#keys}

    # HTTP-first: inject via the opencode TUI's embedded server if available
    local oc_port
    if oc_port=$(_tmux_oc_port "$window") 2>/dev/null; then
        local payload
        if payload=$(jq -cn --arg t "$keys" '{text: $t}' 2>/dev/null); then
            if curl -sf -m 5 -X POST "http://127.0.0.1:${oc_port}/tui/append-prompt" \
                    -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1; then
                sleep 0.2
                curl -sf -m 5 -X POST "http://127.0.0.1:${oc_port}/tui/submit-prompt" \
                    -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 && return 0
            fi
        fi
    fi

    # For long messages (>4KB), use buffer-based approach
    # This avoids issues with send-keys -l on large text
    if [[ $msg_len -gt 4096 ]]; then
        local tmpfile
        tmpfile=$(mktemp)
        printf '%s' "$keys" > "$tmpfile"

        # Load into named buffer and paste
        tmux load-buffer -b soren-msg "$tmpfile"
        tmux paste-buffer -t "${session}:${window}" -b soren-msg -d
        rm -f "$tmpfile"

        # Longer delay for large messages - the TUI needs time to process
        sleep 0.5
    else
        # Send text literally for shorter messages
        tmux send-keys -t "${session}:${window}" -l "$keys"

        # Delay for paste to be processed by the TUI
        # Long single-line messages (>200 chars) trigger paste detection too
        if [[ "$keys" == *$'\n'* ]]; then
            sleep 0.3
        elif [[ $msg_len -gt 200 ]]; then
            sleep 0.3
        else
            sleep 0.1
        fi
    fi

    tmux send-keys -t "${session}:${window}" Enter

    # Auto-detect stuck paste buffers and press Enter again if needed
    tmux_unstick_paste "$session" "$window" 2>/dev/null || true
}

# Send interrupt (Ctrl+C) to a tmux window
tmux_send_interrupt() {
    local session="$1"
    local window="$2"
    tmux send-keys -t "${session}:${window}" C-c
}

# Capture pane content
tmux_capture_pane() {
    local session="$1"
    local window="$2"
    local lines="${3:-100}"
    tmux capture-pane -t "${session}:${window}" -p -S "-${lines}"
}

# Kill a tmux window
tmux_kill_window() {
    local session="$1"
    local window="$2"
    tmux kill-window -t "${session}:${window}" 2>/dev/null || true
}

# List all windows in a session
tmux_list_windows() {
    local session="$1"
    tmux list-windows -t "$session" -F "#{window_name}" 2>/dev/null || true
}

# Detect and submit stuck paste buffers in a tmux pane.
# After tmux send-keys delivers multiline text, the TUI may show a collapsed
# paste placeholder without submitting. This checks for that pattern and
# presses Enter to unstick it.
#
# Usage: tmux_unstick_paste session window
# Returns: 0 if unstick was needed and performed, 1 if no stuck paste found
tmux_unstick_paste() {
    local session="$1"
    local window="$2"

    sleep 0.5
    local tail_output
    tail_output=$(tmux capture-pane -t "${session}:${window}" -p -S -5 2>/dev/null) || return 1

    if echo "$tail_output" | grep -qiE '\[(Pasted text|paste #)'; then
        tmux send-keys -t "${session}:${window}" Enter
        sleep 0.2
        return 0
    fi
    return 1
}

# Sweep ALL windows in a session for stuck paste buffers and submit them.
# Designed to be called periodically from monitor.sh or the heartbeat cycle.
#
# Usage: tmux_sweep_stuck_pastes session
tmux_sweep_stuck_pastes() {
    local session="$1"
    local windows
    windows=$(tmux list-windows -t "$session" -F '#{window_name}' 2>/dev/null) || return 0

    while IFS= read -r window; do
        [[ -z "$window" ]] && continue
        # Skip monitor window (it's the dashboard, not an agent)
        [[ "$window" == "monitor" ]] && continue

        local tail_output
        tail_output=$(tmux capture-pane -t "${session}:${window}" -p -S -5 2>/dev/null) || continue

        if echo "$tail_output" | grep -qiE '\[(Pasted text|paste #)'; then
            tmux send-keys -t "${session}:${window}" Enter
            echo "[tmux_sweep] Unstuck paste buffer in ${session}:${window}" >&2
        fi
    done <<< "$windows"
}

# Clear any text stuck in tmux input buffer
# Use this to recover from "[Pasted text]" situations where input is stuck
tmux_clear_input() {
    local session="$1"
    local window="$2"
    # Send Ctrl+U to clear the current line
    tmux send-keys -t "${session}:${window}" C-u
    # Send Escape to exit any special mode / dismiss dialogs
    tmux send-keys -t "${session}:${window}" Escape
    sleep 0.1
}

#═══════════════════════════════════════════════════════════════════════════════
# Unified Pane State Detection & Safe Send
#═══════════════════════════════════════════════════════════════════════════════

# Queue directory for deferred messages
SOREN_SEND_QUEUE_DIR="${SOREN_SEND_QUEUE_DIR:-.soren/send-queue}"

# Look up the opencode embedded-server port for a window (agent) name.
# Internal helper for HTTP-based state checks and message delivery.
#
# Self-healing: registry ports can drift (concurrent starts, monitor
# recovery). If the registered port isn't answering, inspect the pane's
# opencode process for its actual --port and repair the registry.
_tmux_oc_port() {
    local window="$1"
    local reg="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/agent_registry.json"
    local port=""
    if [[ -f "$reg" ]]; then
        port=$(jq -r --arg k "$window" '.[$k].oc_port // empty' "$reg" 2>/dev/null)
        [[ "$port" == "null" ]] && port=""
    fi

    # Registered port that answers is authoritative
    if [[ -n "$port" ]] && curl -sf -m 1 "http://127.0.0.1:${port}/global/health" >/dev/null 2>&1; then
        echo "$port"
        return 0
    fi

    # Self-heal: find the live opencode process in this window's pane tree
    local pane_pid live_port="" pid p args
    pane_pid=$(tmux list-panes -t "${SOREN_SESSION:-soren}:${window}" -F '#{pane_pid}' 2>/dev/null | head -1)
    [[ -n "$pane_pid" ]] || { [[ -n "$port" ]] && echo "$port"; [[ -n "$port" ]]; return; }
    for pid in $(pgrep -P "$pane_pid" 2>/dev/null); do
        for p in "$pid" $(pgrep -P "$pid" 2>/dev/null); do
            args=$(ps -o args= -p "$p" 2>/dev/null) || continue
            if [[ "$args" == *opencode* && "$args" =~ --port[[:space:]=]+([0-9]+) ]]; then
                live_port="${BASH_REMATCH[1]}"
                break 2
            fi
        done
    done

    if [[ -n "$live_port" && "$live_port" != "$port" ]]; then
        # Repair the registry (best effort, non-fatal). Must go through the
        # sqlite master — a direct JSON edit would be clobbered by the next
        # view regeneration.
        if declare -f soren_registry_update >/dev/null 2>&1; then
            if soren_registry_update "$reg" --arg k "$window" --argjson p "$live_port" \
                    '.[$k].oc_port = $p' 2>/dev/null; then
                echo "[tmux_oc_port] Healed stale oc_port for ${window}: ${port:-none} -> ${live_port}" >&2
            fi
        fi
        echo "$live_port"
        return 0
    fi

    [[ -n "${live_port:-$port}" ]] || return 1
    echo "${live_port:-$port}"
}

# Detect the current state of a tmux pane running an opencode TUI.
# Returns one of: PROMPT, CONFIRMATION, SELECTION, BUSY, UNKNOWN
# Only PROMPT is safe for sending input.
#
# Detection strategy:
#   1. If the agent's embedded opencode server responds, the TUI is up.
#      Busy vs idle is inferred from the pane's status line.
#   2. If no port is registered (e.g. plain shell), fall back to text patterns.
#
# Usage: state=$(tmux_pane_state "$session" "$window")
tmux_pane_state() {
    local session="$1"
    local window="$2"

    local output
    output=$(tmux_capture_pane "$session" "$window" 10 2>/dev/null) || {
        echo "UNKNOWN"
        return 0
    }

    # Empty output
    if [[ -z "$output" ]]; then
        echo "UNKNOWN"
        return 0
    fi

    # Get last non-empty lines for pattern matching
    local last_lines
    last_lines=$(echo "$output" | grep -v '^$' | tail -5)

    # CONFIRMATION — y/n prompts (shell tools, git hooks, etc.)
    if echo "$last_lines" | grep -qE '\(y/n\)|\(Y/N\)|\[y/N\]|\[Y/n\]|\(yes/no\)|\(Yes/No\)'; then
        echo "CONFIRMATION"
        return 0
    fi

    # SELECTION — numbered option lists near end of output (dialogs)
    if echo "$last_lines" | grep -qE '^[[:space:]]*[1-4][).] '; then
        echo "SELECTION"
        return 0
    fi

    # HTTP health check — authoritative when the agent has a registered port
    local port
    if port=$(_tmux_oc_port "$window"); then
        if curl -sf -m 2 "http://127.0.0.1:${port}/global/health" >/dev/null 2>&1; then
            # TUI is up. Busy if the status line shows generation in progress.
            if echo "$last_lines" | grep -qiE 'esc.{0,8}interrupt|working|thinking\.\.\.'; then
                echo "BUSY"
            else
                echo "PROMPT"
            fi
            return 0
        fi
        # Port registered but server down — agent dead or still starting
        echo "UNKNOWN"
        return 0
    fi

    # No registered port — fall back to text heuristics.
    # opencode busy indicators
    if echo "$last_lines" | grep -qiE 'esc.{0,8}interrupt|working\.\.\.|thinking\.\.\.'; then
        echo "BUSY"
        return 0
    fi

    # Generic prompt indicators (opencode input box, shell prompts)
    if echo "$last_lines" | grep -qE '❯|^> |^\$ |^% '; then
        echo "PROMPT"
        return 0
    fi

    # None matched — agent is mid-output or in unknown state
    echo "BUSY"
    return 0
}

# Safe send — checks pane state before sending.
#
# Usage: tmux_safe_send session window text [--force] [--retry N] [--queue]
#
# Returns:
#   0 = sent successfully
#   1 = unsafe (pane not at prompt, no flags to handle it)
#   2 = queued for later delivery
#
# Flags:
#   --force    Send regardless of pane state (for emergencies like sentry)
#   --retry N  Wait 3s and retry up to N times if not at prompt
#   --queue    Queue message for later delivery if not at prompt
tmux_safe_send() {
    local session="$1"
    local window="$2"
    local text="$3"
    shift 3

    local force=false
    local retry=0
    local queue=false

    # Parse optional flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --force)  force=true; shift ;;
            --retry)  retry="$2"; shift 2 ;;
            --queue)  queue=true; shift ;;
            *)        shift ;;
        esac
    done

    # Force mode — skip all checks
    if $force; then
        tmux_send_keys "$session" "$window" "$text"
        return 0
    fi

    # Check pane state
    local state
    state=$(tmux_pane_state "$session" "$window")

    if [[ "$state" == "PROMPT" ]]; then
        tmux_send_keys "$session" "$window" "$text"
        return 0
    fi

    # Not at prompt — try retries
    local attempt=0
    while ((attempt < retry)); do
        ((attempt++))
        sleep 3
        state=$(tmux_pane_state "$session" "$window")
        if [[ "$state" == "PROMPT" ]]; then
            tmux_send_keys "$session" "$window" "$text"
            return 0
        fi
    done

    # Still not at prompt — queue if requested
    if $queue; then
        _tmux_queue_message "$session" "$window" "$text"
        return 2
    fi

    # Not safe, no retry left, no queue — report failure
    echo "[tmux_safe_send] Cannot send to ${session}:${window} — pane state: ${state}" >&2
    return 1
}

# Queue a message for later delivery (internal helper)
_tmux_queue_message() {
    local session="$1"
    local window="$2"
    local text="$3"

    mkdir -p "$SOREN_SEND_QUEUE_DIR"
    local queue_file="${SOREN_SEND_QUEUE_DIR}/${session}:${window}"

    # Base64 encode to handle special chars and newlines
    local encoded
    if command -v base64 &>/dev/null; then
        encoded=$(printf '%s' "$text" | base64)
    else
        echo "[tmux_safe_send] base64 not available, cannot queue message" >&2
        return 1
    fi

    echo "$encoded" >> "$queue_file"
}

# Drain queued messages for a target window.
# Called by router.sh on each cycle.
#
# Usage: tmux_drain_queue session window
tmux_drain_queue() {
    local session="$1"
    local window="$2"

    local queue_file="${SOREN_SEND_QUEUE_DIR}/${session}:${window}"
    [[ -f "$queue_file" ]] || return 0

    # Check if window is at prompt before draining
    local state
    state=$(tmux_pane_state "$session" "$window")
    if [[ "$state" != "PROMPT" ]]; then
        return 0  # Not ready, try again later
    fi

    # Read and process queued messages
    local tmpfile
    tmpfile=$(mktemp)
    mv "$queue_file" "$tmpfile"

    local delivered=0
    while IFS= read -r encoded_line; do
        [[ -z "$encoded_line" ]] && continue

        local decoded
        decoded=$(printf '%s' "$encoded_line" | base64 -d 2>/dev/null) || {
            echo "[tmux_drain_queue] Failed to decode queued message" >&2
            continue
        }

        # Send without --queue to avoid infinite loop
        if tmux_safe_send "$session" "$window" "$decoded" --retry 1; then
            ((delivered++))
        else
            # Re-queue failed messages
            _tmux_queue_message "$session" "$window" "$decoded"
            break  # Stop draining — pane is no longer at prompt
        fi
    done < "$tmpfile"

    rm -f "$tmpfile"

    if ((delivered > 0)); then
        echo "[tmux_drain_queue] Delivered $delivered queued message(s) to ${session}:${window}" >&2
    fi
}
