#!/usr/bin/env bash
#===============================================================================
# router.sh - Message Router Daemon
#
# Routes messages from the mailbox to target agents or the user.
# Watches .soren/mailbox for new JSONL messages and delivers them.
#
# Mailbox Format (one JSON object per line):
#   {"ts":"...","from":"soren:worker","to":"soren:supervisor","subject":"...","body":"path"}
#
# Examples:
#   {"ts":"2026-01-31T06:00:00Z","from":"soren:worker-auth","to":"soren:supervisor","subject":"[DONE] JWT complete"}
#   {"ts":"2026-01-31T06:00:00Z","from":"soren:worker","to":"user","subject":"Bug fixed","body":"path/to/file.md"}
#===============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/tmux.sh"
source "${SCRIPT_DIR}/lib/logging.sh"
source "${SCRIPT_DIR}/lib/filelock.sh"

# Single-instance enforcement (portable: Linux flock / macOS python3 fcntl)
ROUTER_LOCKFILE="${SOREN_PROJECT_ROOT:-.}/.soren/run/router.lock"
mkdir -p "$(dirname "$ROUTER_LOCKFILE")" 2>/dev/null || true
exec 200>"$ROUTER_LOCKFILE"
if command -v flock &>/dev/null; then
    flock -n 200 || { echo "[router] Another instance is already running. Exiting." >&2; exit 0; }
else
    python3 -c "import fcntl; fcntl.flock(200, fcntl.LOCK_EX | fcntl.LOCK_NB)" 2>/dev/null || { echo "[router] Another instance is already running. Exiting." >&2; exit 0; }
fi
echo $$ > "${SOREN_PROJECT_ROOT:-.}/.soren/run/router.pid"

SOREN_SESSION="${SOREN_SESSION:-soren}"
SOREN_MAILBOX="${SOREN_MAILBOX:-.soren/mailbox}"
SOREN_PORT="${SOREN_PORT:-8000}"
SOREN_ROUTER_LOG="${SOREN_ROUTER_LOG:-.soren/router.log}"

POLL_INTERVAL=2
LINE_MARKER=".soren/.router_line"

#-------------------------------------------------------------------------------
# Logging
#-------------------------------------------------------------------------------

log_route() {
    local status="$1"
    local from="$2"
    local to="$3"
    local details="${4:-}"
    echo "$(date -Iseconds) | $status | $from -> $to | $details" >> "$SOREN_ROUTER_LOG"
}

#-------------------------------------------------------------------------------
# Position Tracking (line-based)
#-------------------------------------------------------------------------------

get_last_line() {
    if [[ -f "$LINE_MARKER" ]]; then
        local val
        val=$(cat "$LINE_MARKER")
        # Validate: must be a non-negative integer
        if [[ "$val" =~ ^[0-9]+$ ]]; then
            echo "$val"
        else
            log_route "WARN" "router" "self" "invalid line marker '$val', resetting to 0"
            echo "0"
        fi
    else
        echo "0"
    fi
}

save_line() {
    echo "$1" > "$LINE_MARKER"
}

#-------------------------------------------------------------------------------
# Session Discovery
#-------------------------------------------------------------------------------

get_soren_sessions() {
    tmux list-sessions -F '#{session_name}' 2>/dev/null | grep -E '^soren(-|$)' || true
}

#-------------------------------------------------------------------------------
# Message Parsing (JSONL)
#-------------------------------------------------------------------------------

# Parse a single JSONL line and extract fields
# Returns: id|timestamp|from|to|subject|body_path|status
# For status_update records, returns: _status_update|id|status
# Uses jq for reliable JSON parsing - no regex, no ambiguity
parse_line() {
    local line="$1"

    # Skip empty/whitespace-only lines
    [[ -z "${line// /}" ]] && return 1

    # Skip non-JSON lines (old-format messages, comments, etc.)
    [[ "$line" != \{* ]] && return 1

    # Check if this is a status_update record
    local line_type
    line_type=$(echo "$line" | jq -r '.type // ""' 2>/dev/null)
    if [[ "$line_type" == "status_update" ]]; then
        local update_parsed
        if update_parsed=$(echo "$line" | jq -r '[.id // "", .status // ""] | join("|")' 2>/dev/null); then
            echo "_status_update|$update_parsed"
            return 0
        fi
        return 1
    fi

    # Validate JSON and extract fields in one jq call
    local parsed
    if ! parsed=$(echo "$line" | jq -r '[.id // "", .ts // "", .from // "", .to // "", .subject // "", .body // "", .status // ""] | join("|")' 2>/dev/null); then
        log_route "PARSE_FAIL" "unknown" "unknown" "invalid JSON: ${line:0:60}"
        return 1
    fi

    # Verify we got required fields
    local msg_id timestamp from to subject body_path status
    IFS='|' read -r msg_id timestamp from to subject body_path status <<< "$parsed"

    if [[ -z "$from" ]] || [[ -z "$to" ]] || [[ -z "$subject" ]]; then
        log_route "PARSE_FAIL" "${from:-unknown}" "${to:-unknown}" "missing required fields"
        return 1
    fi

    log_route "PARSED" "$from" "$to" "id=${msg_id:0:8} subject=${subject:0:40}"
    echo "$parsed"
    return 0
}

#-------------------------------------------------------------------------------
# Message Storage & Broadcast
#-------------------------------------------------------------------------------

store_message_via_api() {
    local from="$1"
    local to="$2"
    local content="$3"
    local msg_type="${4:-mailbox}"
    local task_status="${5:-}"

    # Extract agent name from session:agent format
    local from_agent="${from##*:}"
    local to_agent="${to##*:}"
    [[ "$to" == "user" ]] && to_agent="user"

    # Build JSON payload
    local payload
    if [[ -n "$task_status" ]]; then
        payload="{
            \"from_agent\": \"$from_agent\",
            \"to_agent\": \"$to_agent\",
            \"content\": $(echo "$content" | jq -Rs .),
            \"type\": \"$msg_type\",
            \"task_status\": \"$task_status\"
        }"
    else
        payload="{
            \"from_agent\": \"$from_agent\",
            \"to_agent\": \"$to_agent\",
            \"content\": $(echo "$content" | jq -Rs .),
            \"type\": \"$msg_type\"
        }"
    fi

    # Call internal API to store message and broadcast to WebSocket
    curl -sf -X POST "http://localhost:${SOREN_PORT}/api/messages/internal" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null 2>&1 || {
            log_route "WARN" "$from" "$to" "failed to store in DB (API unavailable)"
        }
}

# Update a message's task status via API
update_status_via_api() {
    local msg_id="$1"
    local new_status="$2"

    curl -sf -X PATCH "http://localhost:${SOREN_PORT}/api/messages/${msg_id}/status" \
        -H "Content-Type: application/json" \
        -d "{\"status\": \"$new_status\"}" \
        >/dev/null 2>&1 || {
            log_route "WARN" "router" "api" "failed to update status for $msg_id"
        }
}

#-------------------------------------------------------------------------------
# Message Routing
#-------------------------------------------------------------------------------

route_message() {
    local msg_id="$1"
    local from="$2"
    local to="$3"
    local subject="$4"
    local body_path="$5"
    local status="${6:-}"

    # Build content for storage
    # body_path is either a file path (starts with /) or inline text
    local content="$subject"
    if [[ -n "$body_path" ]]; then
        if [[ "$body_path" == /* ]]; then
            content="$subject (see: $body_path)"
        else
            content="$subject | $body_path"
        fi
    fi

    # Skip DB storage + dashboard broadcast for internal verification messages
    # These are agent-to-agent and should not surface to the user
    local is_internal=false
    case "$subject" in
        *"[COMMIT-CHECK]"*|*"[VERIFIED]"*|*"[VERIFY-WARN]"*|*"[VERIFY-FAILED]"*|*"[FIX-REQUEST]"*|*"[UI-CHECK]"*)
            is_internal=true ;;
    esac

    if [[ "$is_internal" == "false" ]]; then
        # Store in DB + broadcast to frontend (with task_status if present)
        store_message_via_api "$from" "$to" "$content" "mailbox" "$status"
    else
        log_route "INTERNAL" "$from" "$to" "skipped dashboard broadcast: ${subject:0:50}"
    fi

    # For user-targeted messages, /messages/internal already stored + broadcast.
    # No second call needed — the old /messages/user call caused duplicate display.
    local to_agent_name="${to##*:}"
    if [[ "$to" == "user" ]] || [[ "$to_agent_name" == "user" ]]; then
        log_route "DELIVERED" "$from" "user" "via API"
        return 0
    fi

    # Parse session:window from address
    local session window
    if [[ "$to" == *":"* ]]; then
        session="${to%%:*}"
        window="${to#*:}"
    else
        session="$SOREN_SESSION"
        window="$to"
    fi

    # Check all soren sessions for the target agent
    local sessions
    sessions=$(get_soren_sessions)
    local delivered=false

    while IFS= read -r sess; do
        [[ -z "$sess" ]] && continue

        # Try exact session match first
        if [[ "$sess" == "$session" ]] && tmux_window_exists "$sess" "$window"; then
            # Build full message — inline body or file reference
            local full_msg="[$from] $subject"
            if [[ -n "$body_path" ]]; then
                if [[ "$body_path" == /* ]]; then
                    full_msg="${full_msg}\n  -> $body_path"
                else
                    full_msg="${full_msg}\n  $body_path"
                fi
            fi

            local send_rc=0
            tmux_safe_send "$sess" "$window" "$full_msg" --retry 3 --queue || send_rc=$?
            if ((send_rc == 0)); then
                log_route "DELIVERED" "$from" "$to" "session=$sess"
            elif ((send_rc == 2)); then
                log_route "QUEUED" "$from" "$to" "session=$sess (pane not at prompt)"
            fi
            delivered=true
            break
        fi
    done <<< "$sessions"

    # If not found in exact session, try any soren session
    if [[ "$delivered" == "false" ]]; then
        while IFS= read -r sess; do
            [[ -z "$sess" ]] && continue
            if tmux_window_exists "$sess" "$window"; then
                local full_msg="[$from] $subject"
                if [[ -n "$body_path" ]]; then
                    if [[ "$body_path" == /* ]]; then
                        full_msg="${full_msg}\n  -> $body_path"
                    else
                        full_msg="${full_msg}\n  $body_path"
                    fi
                fi

                local send_rc=0
                tmux_safe_send "$sess" "$window" "$full_msg" --retry 3 --queue || send_rc=$?
                if ((send_rc == 0)); then
                    log_route "DELIVERED" "$from" "$to" "session=$sess (fallback)"
                elif ((send_rc == 2)); then
                    log_route "QUEUED" "$from" "$to" "session=$sess (fallback, pane not at prompt)"
                fi
                delivered=true
                break
            fi
        done <<< "$sessions"
    fi

    if [[ "$delivered" == "false" ]]; then
        log_route "FAILED" "$from" "$to" "window not found"
        return 1
    fi

    # Update task status to "working" after successful delivery
    if [[ -n "$msg_id" ]]; then
        update_status_via_api "$msg_id" "working"
        log_route "STATUS" "$from" "$to" "id=${msg_id:0:8} -> working"
    fi

    return 0
}

#-------------------------------------------------------------------------------
# Mailbox Processing
#-------------------------------------------------------------------------------

process_mailbox() {
    if [[ ! -f "$SOREN_MAILBOX" ]]; then
        return 0
    fi

    # Get current line count
    local last_line current_line
    last_line=$(get_last_line)
    current_line=$(wc -l < "$SOREN_MAILBOX" | xargs)

    # Detect mailbox truncation/recreation: reset marker if file shrunk
    if ((current_line < last_line)); then
        log_route "WARN" "router" "self" "mailbox shrunk (${last_line} -> ${current_line}), resetting position"
        last_line=0
    fi

    if ((current_line <= last_line)); then
        return 0
    fi

    # Lock mailbox during read + line marker update to prevent reading partial writes
    mailbox_lock

    # Re-check line count under lock (may have changed)
    current_line=$(wc -l < "$SOREN_MAILBOX" | xargs)
    if ((current_line <= last_line)); then
        mailbox_unlock
        return 0
    fi

    # Snapshot the new lines while holding the lock
    local line_num=$((last_line + 1))
    local new_lines
    new_lines=$(tail -n +"$line_num" "$SOREN_MAILBOX")
    local lines_processed=0
    lines_processed=$(echo "$new_lines" | wc -l | xargs)

    # Update line marker while still holding lock
    save_line $((last_line + lines_processed))
    mailbox_unlock

    # Process lines outside the lock (routing can take time)
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip empty lines
        [[ -z "$line" ]] && continue

        # Parse JSONL line
        local parsed
        if parsed=$(parse_line "$line"); then
            # Check if this is a status_update record
            if [[ "$parsed" == _status_update* ]]; then
                local update_id update_status
                IFS='|' read -r _ update_id update_status <<< "$parsed"
                log_info "Status update: $update_id -> $update_status"
                update_status_via_api "$update_id" "$update_status"
            else
                local msg_id timestamp from to subject body_path status
                IFS='|' read -r msg_id timestamp from to subject body_path status <<< "$parsed"
                log_info "Routing: $from -> $to: $subject"
                route_message "$msg_id" "$from" "$to" "$subject" "$body_path" "$status"
            fi
        else
            log_route "SKIP" "unknown" "unknown" "invalid line: ${line:0:50}..."
        fi
    done <<< "$new_lines"
}

#-------------------------------------------------------------------------------
# Queue Draining
#-------------------------------------------------------------------------------

drain_all_queues() {
    local queue_dir="${SOREN_SEND_QUEUE_DIR:-.soren/send-queue}"
    [[ -d "$queue_dir" ]] || return 0

    for queue_file in "$queue_dir"/*; do
        [[ -f "$queue_file" ]] || continue

        # Parse session:window from filename
        local target
        target=$(basename "$queue_file")
        local session="${target%%:*}"
        local window="${target#*:}"

        tmux_drain_queue "$session" "$window" 2>/dev/null || true
    done
}

#-------------------------------------------------------------------------------
# Main
#-------------------------------------------------------------------------------

main() {
    log_info "Message router started (JSONL format)"

    # Ensure directories exist
    mkdir -p "$(dirname "$LINE_MARKER")"
    mkdir -p "$(dirname "$SOREN_ROUTER_LOG")"

    # Verify jq is available
    if ! command -v jq &>/dev/null; then
        log_route "FATAL" "router" "self" "jq is required but not installed"
        log_status "DAEMON" "Router FATAL: jq not installed"
        exit 1
    fi

    # Log startup
    log_route "STARTUP" "router" "all" "Router daemon started (v3 - JSONL format)"
    log_status "DAEMON" "Router daemon started (PID: $$)"

    while true; do
        process_mailbox
        drain_all_queues
        sleep "$POLL_INTERVAL"
    done
}

main
