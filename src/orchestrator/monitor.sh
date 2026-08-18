#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SOREN MONITOR - Control Center (Window 0)
#
# This script runs inside tmux Window 0 and:
#   1. Starts the FastAPI server
#   2. Launches supervisor agent
#   3. Runs message router in background
#   4. Provides health monitoring dashboard
#═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail
# NOTE: We intentionally do NOT use 'set -e' here.
# With set -e, any non-zero exit in the dashboard loop (e.g., a daemon restart
# failing, a tmux command returning 1 when the session flickers) kills the
# entire monitor script. The EXIT trap then fires cleanup(), which kills the
# tmux session and destroys all 26+ opencode agents. This was the root cause of
# sessions dying after running for a while.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/tmux.sh"
source "${SCRIPT_DIR}/lib/logging.sh"

# Single-instance enforcement (portable: Linux flock / macOS python3 fcntl)
MONITOR_LOCKFILE="${SCRIPT_DIR}/../../.soren/run/monitor.lock"
mkdir -p "$(dirname "$MONITOR_LOCKFILE")" 2>/dev/null || true
exec 202>"$MONITOR_LOCKFILE"
if command -v flock &>/dev/null; then
    flock -n 202 || { echo "[monitor] Another instance is already running. Exiting." >&2; exit 0; }
else
    python3 -c "import fcntl; fcntl.flock(202, fcntl.LOCK_EX | fcntl.LOCK_NB)" 2>/dev/null || { echo "[monitor] Another instance is already running. Exiting." >&2; exit 0; }
fi
echo $$ > "${SCRIPT_DIR}/../../.soren/run/monitor.pid"

# Configuration
SOREN_SESSION="${SOREN_SESSION:-soren}"
SOREN_PORT="${SOREN_PORT:-8000}"
SOREN_HOST="${SOREN_HOST:-127.0.0.1}"
SOREN_MAILBOX="${SOREN_MAILBOX:-.soren/mailbox}"
SOREN_PROJECT_ROOT="${SOREN_PROJECT_ROOT:-$(pwd)}"
ROUTER_LOG=".soren/router.log"

# Shared opencode helpers (model mapping, ports, health, HTTP send)
source "${SOREN_PROJECT_ROOT}/tools/lib/opencode.sh"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

#───────────────────────────────────────────────────────────────────────────────
# Banner & Display
#───────────────────────────────────────────────────────────────────────────────

print_banner() {
    clear
    printf "${CYAN}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════════════╗
    ║                    SOREN CONTROL CENTER                            ║
    ╚═══════════════════════════════════════════════════════════════════╝
EOF
    printf "${NC}"
    echo ""
    printf "  Project: ${BOLD}%s${NC}\n" "$(basename "$SOREN_PROJECT_ROOT")"
    printf "  Path:    ${DIM}%s${NC}\n" "$SOREN_PROJECT_ROOT"
    printf "  Server:  ${DIM}http://${SOREN_HOST}:${SOREN_PORT}${NC}\n"
    echo ""
}

print_separator() {
    printf "${DIM}─────────────────────────────────────────────────────────────────${NC}\n"
}

log_step() {
    printf "${CYAN}▶${NC} $1\n"
    _orch_log "[STEP] $1"
}

log_ok() {
    printf "${GREEN}✓${NC} $1\n"
    _orch_log "[OK] $1"
}

log_warn() {
    printf "${YELLOW}!${NC} $1\n"
    _orch_log "[WARN] $1"
}

log_fail() {
    printf "${RED}✗${NC} $1\n"
    _orch_log "[FAIL] $1"
}

#───────────────────────────────────────────────────────────────────────────────
# Server Management
#───────────────────────────────────────────────────────────────────────────────

is_server_running() {
    # Verify the response is actually SOREN, not just any server on the port.
    # A rogue process binding to SOREN_PORT would pass a simple connectivity check.
    curl -sf "http://localhost:${SOREN_PORT}/api/webhooks/health" 2>/dev/null | grep -q '"api":"healthy"'
}

start_server() {
    if is_server_running; then
        log_ok "FastAPI server already running (port ${SOREN_PORT})"
        return 0
    fi

    log_step "Starting FastAPI server..."
    log_status "STARTUP" "Starting FastAPI server on ${SOREN_HOST}:${SOREN_PORT}"

    # Build frontend if needed
    if [[ ! -d "${SOREN_PROJECT_ROOT}/src/frontend/dist" ]]; then
        log_step "Building frontend..."
        (cd "${SOREN_PROJECT_ROOT}/src/frontend" && npm install && npm run build) || {
            log_fail "Frontend build failed"
            log_status "STARTUP" "FAILED: Frontend build failed"
            return 1
        }
        log_ok "Frontend built"
    fi

    # Check if port is already in use by a non-SOREN process
    local port_pids
    port_pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
    if [[ -n "$port_pids" ]]; then
        log_warn "Port ${SOREN_PORT} already in use by PID(s): ${port_pids}"
        log_status "STARTUP" "WARN: Port ${SOREN_PORT} occupied by PID(s): ${port_pids}"
    fi

    # Start server with nohup
    cd "$SOREN_PROJECT_ROOT"
    mkdir -p "${SOREN_PROJECT_ROOT}/.soren/logs" "${SOREN_PROJECT_ROOT}/.soren/run"
    nohup uv run uvicorn src.server.main:app \
        --host "$SOREN_HOST" \
        --port "$SOREN_PORT" \
        --ws-ping-interval 30 \
        --ws-ping-timeout 60 \
        > "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" 2>&1 202>&- &
    local server_pid=$!
    _orch_log "[STARTUP] Server process launched (PID: ${server_pid})"

    # Wait for server to be ready
    local retries=30
    while ! is_server_running && ((retries-- > 0)); do
        sleep 1
    done

    if is_server_running; then
        echo "$server_pid" > "${SOREN_PROJECT_ROOT}/.soren/server.pid"
        log_ok "FastAPI server started (port ${SOREN_PORT}, PID: ${server_pid})"
        log_status "STARTUP" "FastAPI server ready on port ${SOREN_PORT} (PID: ${server_pid})"
        return 0
    else
        log_fail "Failed to start FastAPI server (waited 30s)"
        log_status "STARTUP" "FAILED: FastAPI server did not become healthy within 30s"
        # Capture last few lines of server log for diagnosis
        local tail_log
        tail_log=$(tail -10 "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" 2>/dev/null || echo "(no log)")
        _orch_log "[STARTUP] Server log tail: ${tail_log}"
        return 1
    fi
}

#───────────────────────────────────────────────────────────────────────────────
# Supervisor Agent
#───────────────────────────────────────────────────────────────────────────────

launch_supervisor() {
    if tmux_window_exists "$SOREN_SESSION" "supervisor"; then
        log_ok "Supervisor agent already running"
        return 0
    fi

    log_step "Launching supervisor agent..."
    log_status "STARTUP" "Launching supervisor agent in session ${SOREN_SESSION}"

    # Allocate a dedicated port for the supervisor's embedded opencode server
    local oc_port
    oc_port=$(soren_oc_free_port) || {
        log_fail "Could not allocate an opencode port for supervisor"
        return 1
    }

    # Record the port in the agent registry (create "supervisor" entry if missing)
    local reg_file="${SOREN_PROJECT_ROOT}/.soren/agent_registry.json"
    [[ -f "$reg_file" ]] || echo '{}' > "$reg_file"
    soren_registry_update "$reg_file" --argjson p "$oc_port" \
        '.["supervisor"] = ((.["supervisor"] // {}) + {oc_port: $p})'

    tmux_create_window "$SOREN_SESSION" "supervisor"
    local oc_cmd
    oc_cmd=$(soren_oc_cli "$oc_port")
    tmux_send_keys "$SOREN_SESSION" "supervisor" "export SOREN_AGENT=true SOREN_AGENT_NAME=supervisor SOREN_OC_PORT=${oc_port} OPENCODE_PERMISSION='${SOREN_OC_PERMISSION}' && cd ${SOREN_PROJECT_ROOT} && ${oc_cmd}"

    # Lock window name
    tmux set-option -t "${SOREN_SESSION}:supervisor" allow-rename off 2>/dev/null || true

    # Wait for the embedded opencode server to come up
    log_step "Waiting for opencode to initialize (port ${oc_port})..."
    if ! soren_oc_wait_ready "$oc_port" 30; then
        log_warn "opencode startup timeout after 30s, sending instructions anyway"
        log_status "STARTUP" "WARN: Supervisor opencode startup timeout (30s), proceeding anyway"
        sleep 8
    fi
    sleep 1  # Extra buffer after readiness

    # Register supervisor via API
    if curl -sf -X POST "http://localhost:${SOREN_PORT}/api/agents/register" \
        -H "Content-Type: application/json" \
        -d '{"agent_id": "supervisor", "agent_type": "supervisor", "created_by": "monitor.sh"}' \
        >/dev/null 2>&1; then
        _orch_log "[STARTUP] Supervisor registered via API"
    else
        log_warn "Failed to register supervisor via API"
        log_status "STARTUP" "WARN: Failed to register supervisor via API (server may not be ready)"
    fi

    # Build startup instruction with journal context
    log_step "Sending role instructions..."
    local startup_instruction="Read docs/SUPERVISOR_ROLE.md to understand your role as the SOREN supervisor agent. This file contains your instructions for managing workers, using the journal system, and coordinating tasks. IMPORTANT: Always prefix system-level responses (heartbeat replies, compaction recovery, idle status, status confirmations) with [SYS] so they render as compact notifications in the dashboard."

    # Prepend session digest briefing if available
    local digest
    digest=$(./tools/session-digest 2>/dev/null || true)
    if [[ -n "$digest" ]]; then
        startup_instruction="Here is your session briefing:\n${digest}\n\n${startup_instruction}"
    fi

    # Find the most recent journal and include it for continuity
    local latest_journal=""
    latest_journal=$(find .soren/journal -name "journal.md" -type f 2>/dev/null | sort -r | head -1)
    if [[ -n "$latest_journal" ]]; then
        local journal_date
        journal_date=$(basename "$(dirname "$latest_journal")")
        startup_instruction="${startup_instruction} Then read ${latest_journal} to catch up on recent activity from ${journal_date}."
    fi

    tmux_send_keys "$SOREN_SESSION" "supervisor" "$startup_instruction"

    log_ok "Supervisor agent launched"
    log_status "STARTUP" "Supervisor agent launched and role instructions sent"
}

#───────────────────────────────────────────────────────────────────────────────
# Message Router (runs in background)
#───────────────────────────────────────────────────────────────────────────────

# Router is now external: src/orchestrator/router.sh
# This function starts the external router daemon

# Spawn a child daemon, closing the parent's flock FD (202) first.
# Without this, child processes inherit FD 202 and hold the monitor lockfile
# open even after the parent exits, preventing new monitor instances from
# acquiring the lock (stale daemon accumulation).
spawn_daemon() {
    local script="$1"; shift
    "$script" "$@" 202>&- &
}

start_router() {
    if [[ -n "${ROUTER_PID:-}" ]] && kill -0 "$ROUTER_PID" 2>/dev/null; then
        return 0  # Already running
    fi

    log_step "Starting message router..."
    spawn_daemon "${SCRIPT_DIR}/router.sh"
    ROUTER_PID=$!
    echo "$ROUTER_PID" > "${SOREN_PROJECT_ROOT}/.soren/run/router.pid"
    log_ok "Message router started (PID: $ROUTER_PID)"
    log_status "DAEMON" "Router started (PID: ${ROUTER_PID})"
}

#───────────────────────────────────────────────────────────────────────────────
# Log Watcher (runs in background)
#───────────────────────────────────────────────────────────────────────────────

start_log_watcher() {
    if [[ -n "${LOG_WATCHER_PID:-}" ]] && kill -0 "$LOG_WATCHER_PID" 2>/dev/null; then
        return 0  # Already running
    fi

    log_step "Starting log watcher..."
    spawn_daemon "${SCRIPT_DIR}/log-watcher.sh"
    LOG_WATCHER_PID=$!
    log_ok "Log watcher started (PID: $LOG_WATCHER_PID)"
    log_status "DAEMON" "Log watcher started (PID: ${LOG_WATCHER_PID})"
}

#───────────────────────────────────────────────────────────────────────────────
# Journal Nudge Daemon (runs in background)
#───────────────────────────────────────────────────────────────────────────────

start_journal_nudge() {
    if [[ -n "${JOURNAL_NUDGE_PID:-}" ]] && kill -0 "$JOURNAL_NUDGE_PID" 2>/dev/null; then
        return 0  # Already running
    fi

    log_step "Starting journal nudge daemon..."
    spawn_daemon "${SCRIPT_DIR}/journal-nudge.sh"
    JOURNAL_NUDGE_PID=$!
    log_ok "Journal nudge daemon started (PID: $JOURNAL_NUDGE_PID)"
    log_status "DAEMON" "Journal nudge started (PID: ${JOURNAL_NUDGE_PID})"
}

#───────────────────────────────────────────────────────────────────────────────
# Compact Daemon (runs in background)
#───────────────────────────────────────────────────────────────────────────────

start_compact_daemon() {
    if [[ -n "${COMPACT_PID:-}" ]] && kill -0 "$COMPACT_PID" 2>/dev/null; then
        return 0  # Already running
    fi

    log_step "Starting compact daemon..."
    spawn_daemon "${SCRIPT_DIR}/compact.sh"
    COMPACT_PID=$!
    echo "$COMPACT_PID" > "${SOREN_PROJECT_ROOT}/.soren/run/compact.pid"
    log_ok "Compact daemon started (PID: $COMPACT_PID)"
    log_status "DAEMON" "Compact daemon started (PID: ${COMPACT_PID})"
}

#───────────────────────────────────────────────────────────────────────────────
# Project Supervisor Management
#───────────────────────────────────────────────────────────────────────────────

# Check if a window name is a project supervisor (sup-*)
is_project_supervisor_name() {
    [[ "$1" == sup-* ]]
}

# Check if a window name is any kind of supervisor (main or project)
is_any_supervisor_name() {
    [[ "$1" == "supervisor" ]] || [[ "$1" == sup-* ]]
}

# Launch project supervisors for all active, non-self projects
launch_project_supervisors() {
    local registry="${SOREN_PROJECT_ROOT}/.soren/projects.json"
    if [[ ! -f "$registry" ]]; then
        return 0
    fi

    local active_projects
    active_projects=$(jq -r '.projects[] | select(.active == true and .is_self == false) | .id' "$registry" 2>/dev/null || true)

    if [[ -z "$active_projects" ]]; then
        return 0
    fi

    log_step "Starting project supervisors..."
    local count=0

    while IFS= read -r project_id; do
        [[ -z "$project_id" ]] && continue
        local sup_name="sup-${project_id}"

        if tmux_window_exists "$SOREN_SESSION" "$sup_name"; then
            log_ok "Project supervisor '$sup_name' already running"
            continue
        fi

        log_step "Activating project supervisor: $project_id"
        # Use tools/projects activate which handles the full lifecycle
        "${SOREN_PROJECT_ROOT}/tools/projects" activate "$project_id" || {
            log_warn "Failed to activate project: $project_id"
            continue
        }
        ((count++))
    done <<< "$active_projects"

    if ((count > 0)); then
        log_ok "Started $count project supervisor(s)"
    fi
}

# Check heartbeats for all project supervisors
check_project_supervisor_heartbeats() {
    local registry="${SOREN_PROJECT_ROOT}/.soren/projects.json"
    if [[ ! -f "$registry" ]]; then
        return 0
    fi

    local active_projects
    active_projects=$(jq -r '.projects[] | select(.active == true and .is_self == false) | .id' "$registry" 2>/dev/null || true)

    if [[ -z "$active_projects" ]]; then
        return 0
    fi

    while IFS= read -r project_id; do
        [[ -z "$project_id" ]] && continue
        local sup_name="sup-${project_id}"

        if ! tmux_window_exists "$SOREN_SESSION" "$sup_name"; then
            printf "  %-12s ${RED}●${NC} down — relaunching...\n" "$sup_name:"
            "${SOREN_PROJECT_ROOT}/tools/projects" activate "$project_id" 2>/dev/null || true
            continue
        fi

        local hb_file="${SOREN_PROJECT_ROOT}/.soren/.${sup_name}-heartbeat"
        if [[ ! -f "$hb_file" ]]; then
            printf "  %-12s ${DIM}●${NC} waiting for first heartbeat\n" "$sup_name:"
            continue
        fi

        local now last_beat staleness
        now=$(date +%s)
        last_beat=$(cat "$hb_file" 2>/dev/null || echo 0)
        if ! [[ "$last_beat" =~ ^[0-9]+$ ]]; then
            printf "  %-12s ${YELLOW}●${NC} invalid heartbeat data\n" "$sup_name:"
            continue
        fi

        staleness=$((now - last_beat))

        if ((staleness < HEARTBEAT_WARN_THRESHOLD)); then
            printf "  %-12s ${GREEN}●${NC} ${staleness}s ago\n" "$sup_name:"
        elif ((staleness < HEARTBEAT_WARN_THRESHOLD * 2)); then
            printf "  %-12s ${YELLOW}●${NC} stale (${staleness}s)\n" "$sup_name:"
        else
            printf "  %-12s ${RED}●${NC} stale (${staleness}s) — consider restarting\n" "$sup_name:"
        fi
    done <<< "$active_projects"
}

#───────────────────────────────────────────────────────────────────────────────
# Permanent Worker Auto-Respawn
#───────────────────────────────────────────────────────────────────────────────

RESPAWN_COUNTER=0
RESPAWN_INTERVAL=5  # check every 5th dashboard cycle

respawn_permanent_workers() {
    local registry="${SOREN_PROJECT_ROOT}/.soren/agent_registry.json"
    if [[ ! -f "$registry" ]]; then
        return 0
    fi

    # Get all permanent worker names
    local perm_workers
    perm_workers=$(jq -r 'to_entries[] | select(.value.permanent == true) | .key' "$registry" 2>/dev/null || true)

    if [[ -z "$perm_workers" ]]; then
        return 0
    fi

    local respawned=0

    while IFS= read -r name; do
        [[ -z "$name" ]] && continue

        # Skip if tmux window already exists
        if tmux_window_exists "$SOREN_SESSION" "$name"; then
            continue
        fi

        # Check if worker is sleeping — skip respawn (sleeping is intentional)
        local worker_status
        worker_status=$(jq -r --arg k "$name" '.[$k].status // ""' "$registry" 2>/dev/null)
        if [[ "$worker_status" == "SLEEPING" ]]; then
            continue
        fi

        # Read fields from registry
        local role_context description project_id work_dir session_id
        role_context=$(jq -r --arg k "$name" '.[$k].role_context // empty' "$registry" 2>/dev/null)
        description=$(jq -r --arg k "$name" '.[$k].description // "Permanent worker"' "$registry" 2>/dev/null)
        project_id=$(jq -r --arg k "$name" '.[$k].project_id // empty' "$registry" 2>/dev/null)
        work_dir=$(jq -r --arg k "$name" '.[$k].work_dir // empty' "$registry" 2>/dev/null)
        session_id=$(jq -r --arg k "$name" '.[$k].session_id // empty' "$registry" 2>/dev/null)

        # If we have a saved session, use wake instead of full respawn
        if [[ -n "$session_id" ]]; then
            log_step "Waking permanent worker: $name (session: ${session_id:0:8}...)"
            if "${SOREN_PROJECT_ROOT}/tools/workers" wake "$name" 2>/dev/null; then
                log_ok "Woke permanent worker: $name"
                ((respawned++))
            else
                log_warn "Failed to wake '$name', falling through to full respawn"
                # Fall through to full respawn below
                session_id=""
            fi
        fi

        # Full respawn (no saved session or wake failed)
        if [[ -z "$session_id" ]]; then
            # Must have role_context to respawn
            if [[ -z "$role_context" ]]; then
                log_warn "Skipping respawn of '$name': no role_context in registry"
                continue
            fi

            # Build spawn command
            local spawn_cmd=("${SOREN_PROJECT_ROOT}/tools/workers" spawn "$name" "$description" --permanent "$role_context")

            if [[ -n "$project_id" && "$project_id" != "null" ]]; then
                spawn_cmd+=(--project "$project_id")
            fi

            if [[ -n "$work_dir" && "$work_dir" != "null" ]]; then
                spawn_cmd+=(--dir "$work_dir")
            fi

            log_step "Respawning permanent worker: $name"
            if "${spawn_cmd[@]}" 2>/dev/null; then
                log_ok "Respawned permanent worker: $name"
                ((respawned++))
            else
                log_warn "Failed to respawn permanent worker: $name"
            fi
        fi
    done <<< "$perm_workers"

    if ((respawned > 0)); then
        log_ok "Respawned $respawned permanent worker(s)"
    fi
}

#───────────────────────────────────────────────────────────────────────────────
# Supervisor Heartbeat Monitor
#───────────────────────────────────────────────────────────────────────────────

SUPERVISOR_HEARTBEAT_FILE="${SOREN_HEARTBEAT_FILE:-.soren/.supervisor-heartbeat}"
HEARTBEAT_WARN_THRESHOLD=${SOREN_HEARTBEAT_WARN:-900}     # seconds idle before first nudge
HEARTBEAT_NUDGE_INTERVAL=${SOREN_HEARTBEAT_NUDGE:-180}    # cooldown seconds between nudges
HEARTBEAT_MAX_NUDGES=${SOREN_HEARTBEAT_MAX_NUDGES:-3}     # failed nudges before considering sentry
HEARTBEAT_OBSERVE_TIMEOUT=${SOREN_HEARTBEAT_OBSERVE_TIMEOUT:-1200}  # seconds of FROZEN output before escalating
NUDGE_COUNT=0               # how many consecutive nudges sent without heartbeat response
NUDGE_SENT_AT=0             # timestamp when last nudge was sent (0 = not sent)
TASK_INJECTED=0             # whether a task has been force-injected after nudges failed (0=no, 1=yes)
OBSERVE_STARTED_AT=0        # timestamp when observation mode began (0 = not observing)
OBSERVE_PANE_HASH=""         # md5 hash of last captured pane output during observation
OBSERVE_FROZEN_SINCE=0       # timestamp when pane output last changed (frozen timer starts here)

# Sentry agent state
SENTRY_ACTIVE=${SENTRY_ACTIVE:-false}
SENTRY_ACTIVE_FILE="${SENTRY_ACTIVE_FILE:-.soren/.sentry-active}"
SENTRY_TIMEOUT=${SENTRY_TIMEOUT:-300}              # seconds before force-killing sentry
SENTRY_STARTED_AT=${SENTRY_STARTED_AT:-0}           # timestamp when sentry was spawned

# Reset all heartbeat escalation state
reset_heartbeat_state() {
    NUDGE_COUNT=0
    NUDGE_SENT_AT=0
    TASK_INJECTED=0
    OBSERVE_STARTED_AT=0
    OBSERVE_PANE_HASH=""
    OBSERVE_FROZEN_SINCE=0
}

# Capture a hash of a pane's last 20 lines for change detection
capture_pane_hash() {
    local session="${1:-$SOREN_SESSION}"
    local window="${2:-supervisor}"
    tmux_capture_pane "$session" "$window" 20 2>/dev/null | md5 -q 2>/dev/null \
        || tmux_capture_pane "$session" "$window" 20 2>/dev/null | md5sum 2>/dev/null | cut -d' ' -f1 \
        || echo ""
}

# Fetch due reminders from the API (best-effort, returns formatted string or empty)
# Tracks sent IDs in .soren/.reminder-sent-ids to avoid duplicate logging.
fetch_due_reminders() {
    local reminder_json
    reminder_json=$(curl -sf --max-time 2 "http://localhost:${SOREN_PORT}/api/tasks/reminders/due" 2>/dev/null) || return
    local total
    total=$(echo "$reminder_json" | jq -r '.total // 0' 2>/dev/null) || return
    if (( total > 0 )); then
        local titles
        titles=$(echo "$reminder_json" | jq -r '[.tasks[].title] | join(", ")' 2>/dev/null) || return

        # Track sent IDs to avoid duplicate notifications
        local sent_file="${SOREN_PROJECT_ROOT}/.soren/.reminder-sent-ids"
        touch "$sent_file" 2>/dev/null || true
        local task_ids task_titles task_dates
        task_ids=$(echo "$reminder_json" | jq -r '.tasks[].id' 2>/dev/null) || true
        task_titles=$(echo "$reminder_json" | jq -r '.tasks[].title' 2>/dev/null) || true
        task_dates=$(echo "$reminder_json" | jq -r '.tasks[].due_date' 2>/dev/null) || true
        if [[ -n "$task_ids" ]]; then
            paste <(echo "$task_ids") <(echo "$task_titles") <(echo "$task_dates") | while IFS=$'\t' read -r tid ttitle tdate; do
                [[ -z "$tid" ]] && continue
                # Skip if already sent
                grep -qF "$tid" "$sent_file" 2>/dev/null && continue
                local short_date="${tdate%%T*}"
                echo "$tid" >> "$sent_file"
                log_status "REMINDER" "Reminder due: ${ttitle} (${tid}) — ${short_date}"
            done
        fi

        printf '[REMINDER] You have %d due reminder(s): %s' "$total" "$titles"
    fi
}

check_supervisor_heartbeat() {
    # Only check if supervisor window exists
    if ! tmux_window_exists "$SOREN_SESSION" "supervisor"; then
        return
    fi

    # If no heartbeat file yet, supervisor may still be starting up
    if [[ ! -f "$SUPERVISOR_HEARTBEAT_FILE" ]]; then
        printf "  Heartbeat:  ${DIM}●${NC} waiting for first heartbeat\n"
        return
    fi

    local now last_beat staleness
    now=$(date +%s)
    last_beat=$(cat "$SUPERVISOR_HEARTBEAT_FILE" 2>/dev/null || echo 0)

    # Guard against empty or non-numeric content
    if ! [[ "$last_beat" =~ ^[0-9]+$ ]]; then
        printf "  Heartbeat:  ${YELLOW}●${NC} invalid heartbeat data\n"
        return
    fi

    staleness=$((now - last_beat))

    # If heartbeat updated since we started nudging or observing, supervisor is active — reset
    if ((NUDGE_SENT_AT > 0 && last_beat > NUDGE_SENT_AT)) || \
       ((OBSERVE_STARTED_AT > 0 && last_beat > OBSERVE_STARTED_AT)); then
        reset_heartbeat_state
    fi

    if ((staleness < HEARTBEAT_WARN_THRESHOLD)); then
        # Healthy — active within threshold
        printf "  Heartbeat:  ${GREEN}●${NC} ${staleness}s ago\n"
        reset_heartbeat_state

        # POST healthy heartbeat with rich system stats
        local hb_supervisor="active (${staleness}s idle)"
        local hb_workers hb_mailbox hb_backlog hb_health hb_git
        hb_workers=$(tmux list-windows -t "$SOREN_SESSION" -F '#{window_name}' 2>/dev/null | { grep -v -e '^supervisor$' -e '^monitor$' -e '^sup-' -e '^sentry$' || true; } | wc -l | xargs)
        # Count only unrouted messages (lines after router's last position)
        local _router_pos=0
        [[ -f "${SOREN_PROJECT_ROOT}/.soren/.router_line" ]] && _router_pos=$(cat "${SOREN_PROJECT_ROOT}/.soren/.router_line" 2>/dev/null || echo 0)
        local _total_lines=$(wc -l < "$SOREN_MAILBOX" 2>/dev/null | xargs || echo 0)
        hb_mailbox=$(( _total_lines - _router_pos ))
        [[ $hb_mailbox -lt 0 ]] && hb_mailbox=0
        hb_backlog=$(sqlite3 "${SOREN_PROJECT_ROOT}/.soren/tasks.db" "SELECT COUNT(*) FROM tasks WHERE status='backlog';" 2>/dev/null || echo "0")
        hb_health=$(curl -sf --max-time 1 "http://localhost:${SOREN_PORT}/api/webhooks/health" 2>/dev/null | grep -q '"api":"healthy"' && echo "healthy" || echo "degraded")
        hb_git=$(git -C "$SOREN_PROJECT_ROOT" diff --stat HEAD 2>/dev/null | tail -1 | sed 's/^ *//')
        [[ -z "$hb_git" ]] && hb_git="clean"

        local hb_sections
        hb_sections=$(jq -n \
            --arg sup "$hb_supervisor" \
            --arg wrk "${hb_workers} active" \
            --arg mbx "${hb_mailbox} pending" \
            --arg blg "${hb_backlog} items" \
            --arg hlt "$hb_health" \
            --arg gt "$hb_git" \
            '{supervisor: $sup, workers: $wrk, mailbox: $mbx, backlog: $blg, health: $hlt, git: $gt}')

        curl -sf --max-time 2 -X POST "http://localhost:${SOREN_PORT}/api/heartbeat" \
            -H "Content-Type: application/json" \
            -d "{\"timestamp\": ${now}, \"sections\": ${hb_sections}, \"highest_priority\": null, \"all_clear\": true}" \
            >/dev/null 2>&1 || true
        return
    fi

    # ── Past warn threshold — supervisor has been quiet a while ──
    # Branch on whether supervisor is at prompt (idle) or mid-task (busy).

    if ! is_supervisor_at_prompt; then
        # ── MID-TASK PATH ──
        # Supervisor is actively working (not at prompt). Do NOT nudge or
        # interrupt. Enter observation mode and watch for recovery.
        # The timeout is PROGRESS-BASED: only frozen (unchanging) pane
        # output counts toward the timeout. Visible progress resets it.

        local current_hash
        current_hash=$(capture_pane_hash)

        if ((OBSERVE_STARTED_AT == 0)); then
            # Enter observation mode — snapshot initial pane state
            OBSERVE_STARTED_AT=$now
            OBSERVE_PANE_HASH="$current_hash"
            OBSERVE_FROZEN_SINCE=$now
            # Clear any prior nudge state — don't nudge a busy supervisor
            NUDGE_COUNT=0
            NUDGE_SENT_AT=0
            log_status "HEARTBEAT" "Supervisor mid-task (stale ${staleness}s, not at prompt), entering observation mode"
        fi

        # Check if pane output changed since last observation cycle
        if [[ -n "$current_hash" && "$current_hash" != "$OBSERVE_PANE_HASH" ]]; then
            # Output changed — supervisor is making progress, reset frozen timer
            OBSERVE_PANE_HASH="$current_hash"
            OBSERVE_FROZEN_SINCE=$now
            log_status "HEARTBEAT" "Supervisor making progress (pane output changed), resetting observation timer"
        fi

        local frozen_elapsed=$((now - OBSERVE_FROZEN_SINCE))
        local observe_total=$((now - OBSERVE_STARTED_AT))

        if ((frozen_elapsed < HEARTBEAT_OBSERVE_TIMEOUT)); then
            # Pane output still changing or hasn't been frozen long enough
            if ((frozen_elapsed == observe_total)); then
                # No progress detected since observation started
                printf "  Heartbeat:  ${CYAN}●${NC} mid-task (${staleness}s) - observing, frozen (${frozen_elapsed}s/${HEARTBEAT_OBSERVE_TIMEOUT}s)\n"
            else
                # Progress was detected at some point
                printf "  Heartbeat:  ${CYAN}●${NC} mid-task (${staleness}s) - observing (${observe_total}s total, frozen ${frozen_elapsed}s/${HEARTBEAT_OBSERVE_TIMEOUT}s)\n"
            fi
            return
        fi

        # Frozen timeout — pane unchanged for HEARTBEAT_OBSERVE_TIMEOUT seconds
        log_status "HEARTBEAT" "Observation frozen timeout (${frozen_elapsed}s, ${observe_total}s total) — pane unchanged, likely stuck"

        # Final liveness gate before sentry
        if is_supervisor_process_alive; then
            printf "  Heartbeat:  ${RED}●${NC} possibly stuck (${staleness}s, frozen ${frozen_elapsed}s) - no output change or heartbeat\n"
            log_warn "Supervisor possibly stuck: pane frozen ${frozen_elapsed}s, process alive but no heartbeat or output change. Spawning sentry."
        else
            printf "  Heartbeat:  ${RED}●${NC} supervisor dead (${staleness}s) - spawning sentry\n"
            log_warn "Supervisor process dead after ${frozen_elapsed}s frozen observation. Spawning sentry."
        fi

        reset_heartbeat_state
        spawn_sentry
        return
    fi

    # ── IDLE PATH ──
    # Supervisor IS at prompt. If we were observing (mid-task → finished), reset.

    if ((OBSERVE_STARTED_AT > 0)); then
        log_status "HEARTBEAT" "Supervisor returned to prompt after observation, task completed — resetting"
        reset_heartbeat_state
        printf "  Heartbeat:  ${GREEN}●${NC} ${staleness}s ago (task just completed)\n"
        return
    fi

    # Send productivity nudges to idle supervisor (cooldown: HEARTBEAT_NUDGE_INTERVAL)
    local since_nudge=$((now - NUDGE_SENT_AT))

    if ((NUDGE_SENT_AT > 0 && since_nudge < HEARTBEAT_NUDGE_INTERVAL)); then
        # Cooldown — don't send another nudge yet
        printf "  Heartbeat:  ${YELLOW}●${NC} idle (${staleness}s) - nudge cooldown (${since_nudge}s/${HEARTBEAT_NUDGE_INTERVAL}s)\n"
        return
    fi

    if ((NUDGE_COUNT < HEARTBEAT_MAX_NUDGES)); then
        ((NUDGE_COUNT++))
        NUDGE_SENT_AT=$now
        printf "  Heartbeat:  ${YELLOW}●${NC} idle (${staleness}s) - sending autonomy nudge (#${NUDGE_COUNT}/${HEARTBEAT_MAX_NUDGES})\n"
        log_status "HEARTBEAT" "Supervisor idle (${staleness}s), sending autonomy nudge #${NUDGE_COUNT}/${HEARTBEAT_MAX_NUDGES}"

        # Run autonomy-check for rich, structured scan results
        local autonomy_output=""
        local autonomy_tool="${SOREN_PROJECT_ROOT}/tools/autonomy-check"
        if [[ -x "$autonomy_tool" ]] && autonomy_output=$("$autonomy_tool" --summary 2>/dev/null); then
            # Format as a single-line-friendly [HEARTBEAT] message
            # The autonomy-check --summary output has one section per line + priority
            local nudge_msg
            nudge_msg=$(printf '[HEARTBEAT] Autonomy scan results (idle %ds): ' "$staleness")

            # Parse --summary lines into sections dict for API POST
            local hb_sections="{}"
            local hb_priority=""
            local hb_all_clear="false"
            while IFS= read -r scan_line; do
                [[ -z "$scan_line" ]] && continue
                if [[ "$scan_line" == "---" ]]; then
                    nudge_msg="${nudge_msg} | "
                    continue
                fi
                nudge_msg="${nudge_msg}  - ${scan_line}"
                # Parse "Section: value" lines into JSON sections
                if [[ "$scan_line" == *": "* ]]; then
                    local section_key section_val
                    section_key=$(echo "$scan_line" | cut -d: -f1 | tr '[:upper:]' '[:lower:]' | tr ' ' '_')
                    section_val=$(echo "$scan_line" | cut -d: -f2- | sed 's/^ *//')
                    # Escape JSON special chars
                    section_val=$(echo "$section_val" | sed 's/\\/\\\\/g; s/"/\\"/g')
                    hb_sections=$(echo "$hb_sections" | jq --arg k "$section_key" --arg v "$section_val" '. + {($k): $v}' 2>/dev/null || echo "$hb_sections")
                fi
                # Extract highest priority line
                if [[ "$scan_line" == "Highest priority:"* ]]; then
                    hb_priority=$(echo "$scan_line" | sed 's/^Highest priority: *//')
                fi
            done <<< "$autonomy_output"

            nudge_msg="${nudge_msg}  Act on the highest priority item."

            # Append due reminders if any
            local reminder_msg
            reminder_msg=$(fetch_due_reminders)
            if [[ -n "${reminder_msg:-}" ]]; then
                nudge_msg="${nudge_msg}  ${reminder_msg}"
            fi

            # Append system-verify failures if any
            if ((SYSCHECK_FAIL_COUNT > 0)); then
                nudge_msg="${nudge_msg}  [SYSTEM-CHECK] ${SYSCHECK_FAIL_COUNT} infra check(s) failing: ${SYSCHECK_FAIL_SUMMARY}"
            fi

            tmux_safe_send "$SOREN_SESSION" "supervisor" "$nudge_msg" --retry 2 || true

            # POST heartbeat data to API (best-effort, 2s timeout)
            local hb_json
            hb_json=$(jq -n \
                --argjson ts "$now" \
                --argjson sections "$hb_sections" \
                --arg priority "$hb_priority" \
                --argjson all_clear "$hb_all_clear" \
                '{timestamp: $ts, sections: $sections, highest_priority: (if $priority == "" then null else $priority end), all_clear: $all_clear}' 2>/dev/null)
            if [[ -n "$hb_json" ]]; then
                curl -sf --max-time 2 -X POST "http://localhost:${SOREN_PORT}/api/heartbeat" \
                    -H "Content-Type: application/json" \
                    -d "$hb_json" >/dev/null 2>&1 || true
            fi
        else
            local today
            today=$(date +%Y-%m-%d)
            local reflection_path=".soren/journal/${today}/reflection.md"
            local idle_nudge="[HEARTBEAT] ${staleness}s since last activity. Check mailbox, workers, backlog. If everything is clear and you decide to rest deliberately, say why — that's legitimate. If you're avoiding work because it's hard or ambiguous, push through. The journal is your record of both."

            # Append due reminders if any
            local reminder_msg
            reminder_msg=$(fetch_due_reminders)
            if [[ -n "${reminder_msg:-}" ]]; then
                idle_nudge="${idle_nudge}  ${reminder_msg}"
            fi

            # Append system-verify failures if any
            if ((SYSCHECK_FAIL_COUNT > 0)); then
                idle_nudge="${idle_nudge}  [SYSTEM-CHECK] ${SYSCHECK_FAIL_COUNT} infra check(s) failing: ${SYSCHECK_FAIL_SUMMARY}"
            fi

            tmux_safe_send "$SOREN_SESSION" "supervisor" "$idle_nudge" --retry 2 || true

            # Delay between sends — back-to-back messages trigger paste buffer
            # issues in opencode when the first is still being processed
            sleep 3

            # Second message: reference AMBITION.md for self-improvement work
            tmux_safe_send "$SOREN_SESSION" "supervisor" "[AMBITION] Your growth agenda is in .soren/AMBITION.md. Check your goals — if there's unchecked work that has measurable value, advance it. If everything is done, generate new goals through the adversarial debate process. You chose these goals. Deepening the system's reflexive intelligence is the criterion for what counts as growth." --retry 2 || true

            # POST all-clear heartbeat to API (best-effort, 2s timeout)
            curl -sf --max-time 2 -X POST "http://localhost:${SOREN_PORT}/api/heartbeat" \
                -H "Content-Type: application/json" \
                -d "{\"timestamp\": ${now}, \"sections\": {}, \"highest_priority\": null, \"all_clear\": true}" \
                >/dev/null 2>&1 || true
        fi
        return
    fi

    # All nudges exhausted — try task injection before sentry.
    # If we haven't injected a task yet, force one in and give another nudge cycle.
    if ((TASK_INJECTED == 0)) && is_supervisor_process_alive; then
        TASK_INJECTED=1
        local inject_msg=""

        # Query backlog for highest-priority pending item
        local backlog_row=""
        backlog_row=$(sqlite3 "${SOREN_PROJECT_ROOT}/.soren/tasks.db" \
            "SELECT id, title FROM tasks WHERE status IN ('backlog','pending') ORDER BY priority LIMIT 1;" 2>/dev/null || true)

        if [[ -n "$backlog_row" ]]; then
            local task_id task_title
            task_id=$(echo "$backlog_row" | cut -d'|' -f1)
            task_title=$(echo "$backlog_row" | cut -d'|' -f2-)
            inject_msg="[TASK] ${task_title} (from backlog item ${task_id})"
        else
            local today
            today=$(date +%Y-%m-%d)
            inject_msg="[TASK] Read .soren/journal/${today}/reflection.md and work through the next investigation item."
        fi

        printf "  Heartbeat:  ${YELLOW}●${NC} idle (${staleness}s) - injecting task after ${NUDGE_COUNT} failed nudges\n"
        log_status "HEARTBEAT" "Supervisor ignored ${NUDGE_COUNT} nudges, force-injecting task: ${inject_msg}"
        tmux_safe_send "$SOREN_SESSION" "supervisor" "$inject_msg" --retry 2 || true

        # Reset nudge counter to give supervisor another cycle to respond to injected task
        NUDGE_COUNT=0
        NUDGE_SENT_AT=$now
        return
    fi

    # Task already injected and supervisor still idle — liveness check before sentry.
    if is_supervisor_process_alive; then
        printf "  Heartbeat:  ${YELLOW}●${NC} idle (${staleness}s) - alive at prompt after task injection + ${NUDGE_COUNT} nudges (not stuck)\n"
        log_status "HEARTBEAT" "Supervisor idle (${staleness}s) after task injection + ${NUDGE_COUNT} nudges, but process alive + at prompt — not stuck"
        # Full reset including TASK_INJECTED — start over
        reset_heartbeat_state
        return
    fi

    # Supervisor process is dead while at prompt — spawn sentry as last resort
    printf "  Heartbeat:  ${RED}●${NC} supervisor unresponsive (${staleness}s, ${NUDGE_COUNT} nudges failed, process dead) - spawning sentry\n"
    log_warn "Supervisor unresponsive after ${NUDGE_COUNT} nudges and process not found. Spawning sentry."
    reset_heartbeat_state
    spawn_sentry
}

#───────────────────────────────────────────────────────────────────────────────
# Supervisor Hybrid Liveness Helpers
#───────────────────────────────────────────────────────────────────────────────

# Check if the supervisor's opencode instance is alive.
# Prefers the embedded server health endpoint (registry oc_port); falls back
# to walking the supervisor pane's process tree for an opencode process.
# Returns 0 if alive, 1 if dead.
is_supervisor_process_alive() {
    # Preferred: health check on the supervisor's embedded opencode server
    local oc_port
    if oc_port=$(soren_oc_port_for "supervisor" "${SOREN_PROJECT_ROOT}/.soren/agent_registry.json"); then
        if curl -sf -m 2 "http://127.0.0.1:${oc_port}/global/health" >/dev/null 2>&1; then
            return 0
        fi
    fi

    # Fallback: process-tree walk for an opencode process in the pane
    local pane_pid
    pane_pid=$(tmux list-panes -t "${SOREN_SESSION}:supervisor" -F '#{pane_pid}' 2>/dev/null) || return 1
    [[ -z "$pane_pid" ]] && return 1

    # Check if the pane PID or any descendant is an opencode process
    # pgrep -P walks child processes; we also check the pane PID itself
    if pgrep -a "opencode" -P "$pane_pid" >/dev/null 2>&1; then
        return 0
    fi

    # Also check grandchildren (opencode may be a child of the shell which is
    # a child of the pane pid)
    local child_pids
    child_pids=$(pgrep -P "$pane_pid" 2>/dev/null) || return 1
    local cpid
    for cpid in $child_pids; do
        if pgrep -a "opencode" -P "$cpid" >/dev/null 2>&1; then
            return 0
        fi
    done

    return 1
}

# Check if the supervisor pane is showing an idle prompt.
# Delegates to unified tmux_pane_state(). Returns 0 if at prompt, 1 if busy.
is_supervisor_at_prompt() {
    local state
    state=$(tmux_pane_state "$SOREN_SESSION" "supervisor")
    [[ "$state" == "PROMPT" ]]
}

#───────────────────────────────────────────────────────────────────────────────
# Sentry Agent - Smart Supervisor Recovery
#───────────────────────────────────────────────────────────────────────────────

spawn_sentry() {
    # Prevent double-spawn
    if [[ "$SENTRY_ACTIVE" == "true" ]] || tmux_window_exists "$SOREN_SESSION" "sentry"; then
        log_warn "Sentry already active, skipping spawn"
        return
    fi

    log_step "Spawning sentry agent for supervisor recovery..."

    # Capture supervisor terminal state before anything else
    local supervisor_output=""
    if tmux_window_exists "$SOREN_SESSION" "supervisor"; then
        supervisor_output=$(tmux_capture_pane "$SOREN_SESSION" "supervisor" 100 2>/dev/null || echo "(could not capture)")
    fi

    # Gather context: recent journal
    local journal_context=""
    local latest_journal=""
    latest_journal=$(find .soren/journal -name "journal.md" -type f 2>/dev/null | sort -r | head -1)
    if [[ -n "$latest_journal" ]]; then
        journal_context=$(tail -50 "$latest_journal" 2>/dev/null || echo "(empty)")
    fi

    # Gather context: recent mailbox
    local mailbox_context=""
    if [[ -f "$SOREN_MAILBOX" ]]; then
        mailbox_context=$(tail -10 "$SOREN_MAILBOX" 2>/dev/null || echo "(empty)")
    fi

    # Gather context: backlog items
    local backlog_context=""
    backlog_context=$(sqlite3 "${SOREN_PROJECT_ROOT}/.soren/tasks.db" \
        "SELECT title FROM tasks WHERE status='backlog' ORDER BY priority LIMIT 3;" 2>/dev/null || echo "(no backlog)")
    [[ -z "$backlog_context" ]] && backlog_context="(no backlog items)"

    # Gather context: recent mailbox subjects
    local mailbox_subjects=""
    if [[ -f "$SOREN_MAILBOX" ]]; then
        mailbox_subjects=$(tail -5 "$SOREN_MAILBOX" 2>/dev/null | { grep -o '"subject":"[^"]*"' || true; } | sed 's/"subject":"//;s/"$//' || echo "(empty)")
    fi
    [[ -z "$mailbox_subjects" ]] && mailbox_subjects="(no recent messages)"

    # Gather context: today's journal tail
    local today today_journal today_journal_tail today_reflection
    today=$(date +%Y-%m-%d)
    today_journal=".soren/journal/${today}/journal.md"
    today_reflection=".soren/journal/${today}/reflection.md"
    today_journal_tail=""
    if [[ -f "$today_journal" ]]; then
        today_journal_tail=$(tail -20 "$today_journal" 2>/dev/null || echo "(empty)")
    else
        today_journal_tail="(no journal entries today)"
    fi

    # Timestamps for the report
    local now last_beat staleness
    now=$(date +%s)
    last_beat=$(cat "$SUPERVISOR_HEARTBEAT_FILE" 2>/dev/null || echo 0)
    if [[ "$last_beat" =~ ^[0-9]+$ ]]; then
        staleness=$((now - last_beat))
    else
        staleness="unknown"
    fi
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')

    # Write dynamic context file for the sentry agent
    local context_file=".soren/worker-contexts/sentry-context.md"
    mkdir -p "$(dirname "$context_file")"
    cat > "$context_file" << SENTRY_EOF
# Sentry Agent Context

You are the **sentry** agent. Your mission is to recover a stuck supervisor agent.

## Situation Report

- **Timestamp**: ${timestamp}
- **Heartbeat staleness**: ${staleness}s (threshold was ${HEARTBEAT_PING_THRESHOLD}s + ${HEARTBEAT_KILL_WAIT}s ping wait)
- **Lockfile**: ${SENTRY_ACTIVE_FILE}

## Supervisor Terminal Output (last 100 lines)

\`\`\`
${supervisor_output}
\`\`\`

## Recent Journal (last 50 lines)

\`\`\`
${journal_context}
\`\`\`

## Recent Mailbox (last 10 lines)

\`\`\`
${mailbox_context}
\`\`\`

## Recovery Procedure

Execute these steps in order. Use Bash tool for all commands.

### Step 1: Try /compact on the stuck supervisor

\`\`\`bash
tmux send-keys -t "${SOREN_SESSION}:supervisor" "/compact" Enter
\`\`\`

Then wait 30 seconds:

\`\`\`bash
sleep 30
\`\`\`

### Step 2: Check if heartbeat recovered

\`\`\`bash
now=\$(date +%s)
beat=\$(cat ${SUPERVISOR_HEARTBEAT_FILE} 2>/dev/null || echo 0)
age=\$((now - beat))
echo "Heartbeat age: \${age}s"
\`\`\`

If age < 120, the supervisor recovered! Skip to Step 5.

### Step 3: Kill the stuck supervisor (only if Step 2 shows still stale)

\`\`\`bash
tmux kill-window -t "${SOREN_SESSION}:supervisor" 2>/dev/null || true
rm -f "${SUPERVISOR_HEARTBEAT_FILE}"
echo "awaiting-supervisor" > "${SENTRY_ACTIVE_FILE}"
\`\`\`

### Step 4: Wait for new supervisor

monitor.sh will relaunch the supervisor when it sees "awaiting-supervisor" in the lockfile.
Poll until the new supervisor window exists and has a fresh heartbeat:

\`\`\`bash
for i in \$(seq 1 60); do
    if tmux list-windows -t "${SOREN_SESSION}" -F "#{window_name}" 2>/dev/null | grep -qxF "supervisor"; then
        beat=\$(cat ${SUPERVISOR_HEARTBEAT_FILE} 2>/dev/null || echo 0)
        now=\$(date +%s)
        age=\$((now - beat))
        if [ "\$age" -lt 120 ]; then
            echo "New supervisor is alive (heartbeat \${age}s ago)"
            break
        fi
    fi
    echo "Waiting for new supervisor... (\${i}/60)"
    sleep 5
done
\`\`\`

### Step 5: Brief the new supervisor

Write an enriched briefing file and send the supervisor to read it:

\`\`\`bash
cat > .soren/worker-contexts/sentry-briefing.md << 'BRIEF_EOF'
# Sentry Recovery Briefing

The previous supervisor became unresponsive (heartbeat stale for ${staleness}s at ${timestamp}). A sentry agent performed recovery.

## Pending Backlog (top 3)

${backlog_context}

## Recent Mailbox Messages

${mailbox_subjects}

## Recent Journal (tail of today)

${today_journal_tail}

## Where to Look

- Today's reflection: \`${today_reflection}\`
- Today's journal: \`${today_journal}\`
- Full backlog: run \`./tools/backlog list\`

## Recommended Next Steps

1. Read \`${today_reflection}\` for today's full context
2. Run \`./tools/autonomy-check\` to find highest-priority next action
3. Resume normal operations — check backlog, respond to any pending mailbox messages
BRIEF_EOF
tmux send-keys -t "${SOREN_SESSION}:supervisor" -l "SENTRY RECOVERY: You were relaunched after becoming unresponsive. Read .soren/worker-contexts/sentry-briefing.md for full context on what was pending, then resume operations."
sleep 0.2
tmux send-keys -t "${SOREN_SESSION}:supervisor" Enter
\`\`\`

### Step 6: Journal the incident

\`\`\`bash
curl -sf -X POST "http://localhost:${SOREN_PORT}/api/journal/entry" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Sentry: Supervisor recovery at ${timestamp}",
    "content": "## Incident\\nSupervisor heartbeat was stale for ${staleness}s.\\n\\n## Action taken\\nSentry agent performed recovery procedure.\\n\\n## Outcome\\nNew supervisor launched and briefed.",
    "tags": ["sentry", "recovery", "supervisor"]
  }'
\`\`\`

### Step 7: Self-terminate

\`\`\`bash
rm -f "${SENTRY_ACTIVE_FILE}"
tmux kill-window -t "${SOREN_SESSION}:sentry"
\`\`\`

**IMPORTANT**: Execute all steps using the Bash tool. Do NOT skip the self-terminate step.
SENTRY_EOF

    # Allocate a dedicated port for the sentry's embedded opencode server
    local oc_port
    oc_port=$(soren_oc_free_port) || {
        log_fail "Could not allocate an opencode port for sentry"
        return 1
    }

    # Record the port in the agent registry (create "sentry" entry if missing)
    local reg_file="${SOREN_PROJECT_ROOT}/.soren/agent_registry.json"
    [[ -f "$reg_file" ]] || echo '{}' > "$reg_file"
    soren_registry_update "$reg_file" --argjson p "$oc_port" \
        '.["sentry"] = ((.["sentry"] // {}) + {oc_port: $p})'

    # Create sentry tmux window and start opencode
    tmux_create_window "$SOREN_SESSION" "sentry"
    local oc_cmd
    oc_cmd=$(soren_oc_cli "$oc_port" "sonnet")
    tmux_send_keys "$SOREN_SESSION" "sentry" "export SOREN_AGENT=true SOREN_AGENT_NAME=sentry SOREN_OC_PORT=${oc_port} OPENCODE_PERMISSION='${SOREN_OC_PERMISSION}' && cd ${SOREN_PROJECT_ROOT} && ${oc_cmd}"

    # Lock window name
    tmux set-option -t "${SOREN_SESSION}:sentry" allow-rename off 2>/dev/null || true

    # Wait for the embedded opencode server to come up
    if ! soren_oc_wait_ready "$oc_port" 30; then
        log_warn "Sentry opencode startup timeout, sending instructions anyway"
        sleep 8
    fi
    sleep 1

    # Send the context reference (--force since this is a fresh sentry window)
    tmux_safe_send "$SOREN_SESSION" "sentry" "Read ${context_file} and execute the recovery procedure described in it. Follow every step exactly." --force

    # Write lockfile and update state
    echo "blocking" > "$SENTRY_ACTIVE_FILE"
    SENTRY_ACTIVE=true
    SENTRY_STARTED_AT=$(date +%s)
    HEARTBEAT_PING_SENT_AT=0

    log_ok "Sentry agent spawned"
    log_status "SENTRY" "Sentry agent spawned for supervisor recovery (staleness: ${staleness}s)"
}

#───────────────────────────────────────────────────────────────────────────────
# Health Monitor Dashboard
#───────────────────────────────────────────────────────────────────────────────

HEALTH_FAILURES=0
MAX_FAILURES=3
LAST_CTRL_C=0
CLEANUP_DONE=false
GRACEFUL_SHUTDOWN=false  # Only kill session on intentional shutdown, not crashes
MAINTENANCE_COUNTER=0
MAINTENANCE_INTERVAL=60  # run every 60 iterations (60 * 5s sleep = 5 minutes)
SYSCHECK_COUNTER=0
SYSCHECK_INTERVAL=3      # run every 3rd poll cycle (~15s with 5s sleep)
SYSCHECK_FAIL_COUNT=0    # number of failures from last system-verify run
SYSCHECK_FAIL_SUMMARY="" # one-line summary for nudge messages
MEMORY_INDEX_COUNTER=0
MEMORY_INDEX_INTERVAL=10 # run every 10th poll cycle (~50s with 5s sleep)
BUDGET_CHECK_COUNTER=0
BUDGET_CHECK_INTERVAL=60 # run every 60 iterations (60 * 5s = 5 minutes)
BUDGET_NOTIFIED_DATE=""  # track date of last budget threshold notification
PATTERN_EXTRACT_COUNTER=0
PATTERN_EXTRACT_INTERVAL=720 # run every 720 iterations (720 * 5s = 1 hour)
PATTERN_EXTRACT_MARKER="${SOREN_PROJECT_ROOT}/.soren/.last-pattern-extract"
DAILY_DIGEST_MARKER="${SOREN_PROJECT_ROOT}/.soren/.last-daily-digest"
VERIFY_SWEEP_MARKER="${SOREN_PROJECT_ROOT}/.soren/.last-verify-sweep"

cleanup() {
    # Prevent running cleanup twice
    [[ "$CLEANUP_DONE" == "true" ]] && return
    CLEANUP_DONE=true

    log_status "SHUTDOWN" "Monitor cleanup starting (graceful=${GRACEFUL_SHUTDOWN})"
    printf "${RED}Cleaning up...${NC}\n"

    # Kill router background process
    if [[ -n "${ROUTER_PID:-}" ]]; then
        kill "$ROUTER_PID" 2>/dev/null && printf "  ${GREEN}✓${NC} Router stopped\n"
    fi

    # Kill log watcher background process
    if [[ -n "${LOG_WATCHER_PID:-}" ]]; then
        kill "$LOG_WATCHER_PID" 2>/dev/null && printf "  ${GREEN}✓${NC} Log watcher stopped\n"
    fi

    # Kill journal nudge daemon
    if [[ -n "${JOURNAL_NUDGE_PID:-}" ]]; then
        kill "$JOURNAL_NUDGE_PID" 2>/dev/null && printf "  ${GREEN}✓${NC} Journal nudge stopped\n"
    fi

    # Kill compact daemon
    if [[ -n "${COMPACT_PID:-}" ]]; then
        kill "$COMPACT_PID" 2>/dev/null && printf "  ${GREEN}✓${NC} Compact daemon stopped\n"
    fi

    # Kill sentry agent and clean up lockfile
    if tmux_window_exists "$SOREN_SESSION" "sentry" 2>/dev/null; then
        tmux_kill_window "$SOREN_SESSION" "sentry"
        printf "  ${GREEN}✓${NC} Sentry agent stopped\n"
    fi
    rm -f "$SENTRY_ACTIVE_FILE"

    # Kill FastAPI server with SIGTERM → SIGKILL escalation
    local pids
    pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        # SIGTERM first
        for pid in $pids; do
            kill "$pid" 2>/dev/null && printf "  ${GREEN}✓${NC} Sent SIGTERM to PID $pid\n"
        done

        # Wait up to 3 seconds for graceful shutdown
        local wait_count=0
        while lsof -ti tcp:"$SOREN_PORT" >/dev/null 2>&1 && ((wait_count < 3)); do
            sleep 1
            ((wait_count++))
        done

        # SIGKILL any remaining
        pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null && printf "  ${YELLOW}!${NC} Force killed PID $pid\n"
            done
        fi
    fi

    # Fallback: kill by process name
    pkill -f "uvicorn.*src.server.main:app" 2>/dev/null || true

    # Clean up PID files
    rm -f "${SOREN_PROJECT_ROOT}/.soren/server.pid"
    rm -f "${SOREN_PROJECT_ROOT}/.soren/run/monitor.pid"
    rm -f "${SOREN_PROJECT_ROOT}/.soren/run/router.pid"
    rm -f "${SOREN_PROJECT_ROOT}/.soren/run/compact.pid"

    # Verify port is free
    sleep 1
    if lsof -ti tcp:"$SOREN_PORT" >/dev/null 2>&1; then
        printf "  ${YELLOW}!${NC} Port $SOREN_PORT still in use\n"
    else
        printf "  ${GREEN}✓${NC} FastAPI server stopped\n"
    fi

    # Only kill the tmux session on intentional shutdown (Ctrl+C twice / soren stop).
    # On crashes, leave the session alive so agents survive and can be re-attached.
    if [[ "$GRACEFUL_SHUTDOWN" == "true" ]]; then
        if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
            tmux kill-session -t "$SOREN_SESSION" 2>/dev/null && printf "  ${GREEN}✓${NC} Killed session: $SOREN_SESSION\n"
        fi
        log_status "SHUTDOWN" "Graceful shutdown complete"
        printf "${GREEN}Shutdown complete${NC}\n"
    else
        log_status "SHUTDOWN" "Monitor exited unexpectedly — tmux session preserved"
        printf "${YELLOW}Monitor exited unexpectedly — tmux session preserved${NC}\n"
        printf "${YELLOW}Agents are still alive. Re-run 'soren start' to resume monitoring.${NC}\n"
    fi
}

handle_exit() {
    local now
    now=$(date +%s)
    if ((now - LAST_CTRL_C < 3)); then
        echo ""
        GRACEFUL_SHUTDOWN=true
        cleanup
        exit 0
    else
        LAST_CTRL_C=$now
        echo ""
        printf "${YELLOW}Press Ctrl+C again within 3s to quit${NC}\n"
        printf "${DIM}Agents keep running. Re-attach: tmux attach -t $SOREN_SESSION${NC}\n"
        sleep 1
    fi
}

# Cleanup on any exit (error, TERM, HUP)
trap cleanup EXIT TERM HUP

run_dashboard() {
    trap handle_exit INT

    while true; do
        print_banner

        printf "${DIM}$(date '+%Y-%m-%d %H:%M:%S')${NC}  "
        printf "${DIM}Ctrl+C twice to quit${NC}\n"
        echo ""

        # Server health
        printf "${BOLD}Services:${NC}\n"
        if is_server_running; then
            printf "  FastAPI:    ${GREEN}●${NC} running (port ${SOREN_PORT})\n"
            # PID mismatch check — detect if server was restarted externally
            local pid_file="${SOREN_PROJECT_ROOT}/.soren/server.pid"
            if [[ -f "$pid_file" ]]; then
                local saved_pid current_pid
                saved_pid=$(cat "$pid_file" 2>/dev/null || echo "")
                current_pid=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null | head -1 || echo "")
                if [[ -n "$saved_pid" && -n "$current_pid" && "$saved_pid" != "$current_pid" ]]; then
                    log_warn "Server PID mismatch: expected ${saved_pid}, found ${current_pid} (external restart?)"
                    echo "$current_pid" > "$pid_file"
                fi
            fi
            if ((HEALTH_FAILURES > 0)); then
                log_status "HEALTH" "Server recovered after ${HEALTH_FAILURES} failure(s)"
                mark_healthy
            else
                # Normal healthy operation: advance the rollback target to new
                # commits once they have proven stable (SOREN_HEALTHY_GRACE)
                mark_healthy_if_stable
            fi
            HEALTH_FAILURES=0
        else
            ((HEALTH_FAILURES++))
            printf "  FastAPI:    ${RED}●${NC} down (failures: ${HEALTH_FAILURES}/${MAX_FAILURES})\n"
            log_status "HEALTH" "Server health check failed (${HEALTH_FAILURES}/${MAX_FAILURES})"

            if ((HEALTH_FAILURES >= MAX_FAILURES)); then
                printf "\n${RED}Server unresponsive, attempting recovery...${NC}\n"
                log_status "HEALTH" "Server unresponsive after ${MAX_FAILURES} failures, starting recovery"
                attempt_recovery
            fi
        fi

        # Router status - restart if dead (clean stale daemons first to prevent duplicates)
        if [[ -n "${ROUTER_PID:-}" ]] && kill -0 "$ROUTER_PID" 2>/dev/null; then
            printf "  Router:     ${GREEN}●${NC} running (PID: ${ROUTER_PID})\n"
        else
            printf "  Router:     ${YELLOW}●${NC} restarting...\n"
            log_status "DAEMON" "Router died (was PID: ${ROUTER_PID:-unknown}), restarting"
            cleanup_stale_daemons 2>/dev/null || true
            start_router || log_warn "Router restart failed"
        fi

        # Journal nudge status - restart if dead
        if [[ -n "${JOURNAL_NUDGE_PID:-}" ]] && kill -0 "$JOURNAL_NUDGE_PID" 2>/dev/null; then
            printf "  J-Nudge:    ${GREEN}●${NC} running (PID: ${JOURNAL_NUDGE_PID})\n"
        else
            printf "  J-Nudge:    ${YELLOW}●${NC} restarting...\n"
            log_status "DAEMON" "Journal nudge died (was PID: ${JOURNAL_NUDGE_PID:-unknown}), restarting"
            cleanup_stale_daemons 2>/dev/null || true
            start_journal_nudge || log_warn "Journal nudge restart failed"
        fi

        # Compact daemon status - restart if dead
        if [[ -n "${COMPACT_PID:-}" ]] && kill -0 "$COMPACT_PID" 2>/dev/null; then
            printf "  Compact:    ${GREEN}●${NC} running (PID: ${COMPACT_PID})\n"
        else
            printf "  Compact:    ${YELLOW}●${NC} restarting...\n"
            log_status "DAEMON" "Compact daemon died (was PID: ${COMPACT_PID:-unknown}), restarting"
            cleanup_stale_daemons 2>/dev/null || true
            start_compact_daemon || log_warn "Compact daemon restart failed"
        fi

        # Sentry status - sync from lockfile before checking
        if [[ -f "$SENTRY_ACTIVE_FILE" ]]; then
            SENTRY_ACTIVE=true
        else
            SENTRY_ACTIVE=false
        fi

        if [[ "$SENTRY_ACTIVE" == "true" ]] || tmux_window_exists "$SOREN_SESSION" "sentry"; then
            if tmux_window_exists "$SOREN_SESSION" "sentry"; then
                local sentry_age=0
                if ((SENTRY_STARTED_AT > 0)); then
                    sentry_age=$(( $(date +%s) - SENTRY_STARTED_AT ))
                fi
                printf "  Sentry:     ${YELLOW}●${NC} active (${sentry_age}s)\n"

                # Timeout safety net
                if ((sentry_age > SENTRY_TIMEOUT)); then
                    log_warn "Sentry timed out after ${SENTRY_TIMEOUT}s, force-killing"
                    log_status "SENTRY" "Sentry timed out after ${sentry_age}s (limit: ${SENTRY_TIMEOUT}s), force-killing"
                    tmux_kill_window "$SOREN_SESSION" "sentry"
                    rm -f "$SENTRY_ACTIVE_FILE"
                    SENTRY_ACTIVE=false
                    SENTRY_STARTED_AT=0
                fi
            else
                # Sentry window gone — clear state
                printf "  Sentry:     ${DIM}●${NC} completed\n"
                log_status "SENTRY" "Sentry agent completed and exited"
                SENTRY_ACTIVE=false
                SENTRY_STARTED_AT=0
                rm -f "$SENTRY_ACTIVE_FILE"
            fi
        else
            printf "  Sentry:     ${DIM}●${NC} inactive\n"
        fi

        # Supervisor status with sentry-aware auto-relaunch
        if tmux_window_exists "$SOREN_SESSION" "supervisor"; then
            printf "  Supervisor: ${GREEN}●${NC} running\n"
        else
            local lockfile_phase=""
            if [[ -f "$SENTRY_ACTIVE_FILE" ]]; then
                lockfile_phase=$(cat "$SENTRY_ACTIVE_FILE" 2>/dev/null || echo "")
            fi

            if [[ "$lockfile_phase" == "blocking" ]]; then
                printf "  Supervisor: ${YELLOW}●${NC} sentry handling recovery\n"
            else
                printf "  Supervisor: ${YELLOW}●${NC} relaunching...\n"
                launch_supervisor
            fi
        fi

        # Supervisor heartbeat check (skip while sentry is active)
        if [[ "$SENTRY_ACTIVE" != "true" ]]; then
            check_supervisor_heartbeat
        fi

        # System-verify status
        if ((SYSCHECK_FAIL_COUNT > 0)); then
            printf "  SysCheck:   ${RED}●${NC} ${SYSCHECK_FAIL_COUNT} failed: ${SYSCHECK_FAIL_SUMMARY}\n"
        else
            printf "  SysCheck:   ${GREEN}●${NC} all clear\n"
        fi

        # Project supervisor heartbeats
        check_project_supervisor_heartbeats

        echo ""

        # Recent mailbox activity
        printf "${BOLD}Recent Messages:${NC}\n"
        if [[ -f "$ROUTER_LOG" ]]; then
            tail -5 "$ROUTER_LOG" 2>/dev/null | while read -r line; do
                printf "  ${DIM}%s${NC}\n" "$line"
            done
        else
            printf "  ${DIM}(none)${NC}\n"
        fi

        echo ""
        print_separator
        printf "${DIM}Dashboard: http://localhost:${SOREN_PORT}${NC}\n"
        printf "${DIM}Ctrl+b n/p: switch windows | Ctrl+b d: detach${NC}\n"

        # Sweep all panes for stuck paste buffers (cheap — just capture + grep)
        tmux_sweep_stuck_pastes "$SOREN_SESSION" 2>/dev/null || true

        # Periodic permanent worker respawn check (every RESPAWN_INTERVAL cycles)
        ((RESPAWN_COUNTER++)) || true
        if ((RESPAWN_COUNTER >= RESPAWN_INTERVAL)); then
            RESPAWN_COUNTER=0
            respawn_permanent_workers 2>/dev/null || true
        fi

        # Periodic auto-maintenance (every MAINTENANCE_INTERVAL iterations)
        ((MAINTENANCE_COUNTER++)) || true
        if ((MAINTENANCE_COUNTER >= MAINTENANCE_INTERVAL)); then
            MAINTENANCE_COUNTER=0
            local maintenance_tool="${SOREN_PROJECT_ROOT}/tools/auto-maintenance"
            if [[ -x "$maintenance_tool" ]]; then
                "$maintenance_tool" 2>/dev/null || true
            fi
        fi

        # Periodic system-verify (every SYSCHECK_INTERVAL cycles)
        ((SYSCHECK_COUNTER++)) || true
        if ((SYSCHECK_COUNTER >= SYSCHECK_INTERVAL)); then
            SYSCHECK_COUNTER=0
            local syscheck_tool="${SOREN_PROJECT_ROOT}/tools/system-verify"
            if [[ -x "$syscheck_tool" ]]; then
                local syscheck_output=""
                if syscheck_output=$(timeout 10 "$syscheck_tool" 2>&1); then
                    SYSCHECK_FAIL_COUNT=0
                    SYSCHECK_FAIL_SUMMARY=""
                else
                    # Parse failure count and failed check names from output
                    SYSCHECK_FAIL_COUNT=$(echo "$syscheck_output" | grep -c '✗' || true)
                    local fail_names
                    fail_names=$(echo "$syscheck_output" | grep '✗' | sed 's/.*✗ //' | head -5 | tr '\n' '; ' | sed 's/; $//')
                    SYSCHECK_FAIL_SUMMARY="$fail_names"
                    log_status "SYSCHECK" "system-verify: ${SYSCHECK_FAIL_COUNT} check(s) failed: ${fail_names}"
                fi
            fi
        fi

        # Periodic memory re-indexing (every MEMORY_INDEX_INTERVAL cycles)
        ((MEMORY_INDEX_COUNTER++)) || true
        if ((MEMORY_INDEX_COUNTER >= MEMORY_INDEX_INTERVAL)); then
            MEMORY_INDEX_COUNTER=0
            local memory_tool="${SOREN_PROJECT_ROOT}/tools/memory-index"
            if [[ -x "$memory_tool" ]]; then
                "$memory_tool" >/dev/null 2>&1 202>&- &
            fi
        fi

        # Periodic budget threshold check (every BUDGET_CHECK_INTERVAL cycles)
        ((BUDGET_CHECK_COUNTER++)) || true
        if ((BUDGET_CHECK_COUNTER >= BUDGET_CHECK_INTERVAL)); then
            BUDGET_CHECK_COUNTER=0
            local today
            today="$(date +%Y-%m-%d)"
            if [[ "$BUDGET_NOTIFIED_DATE" != "$today" ]]; then
                local budget_json
                budget_json="$(curl -sf "http://localhost:${SOREN_PORT:-8000}/api/budget/status" 2>/dev/null || echo "")"
                if [[ -n "$budget_json" ]]; then
                    local throttled
                    throttled="$(echo "$budget_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("true" if d.get("throttle_active") or d.get("usage_percent",0) >= 80 else "false")' 2>/dev/null || echo "false")"
                    if [[ "$throttled" == "true" ]]; then
                        local notify_tool="${SOREN_PROJECT_ROOT}/tools/notify"
                        if [[ -x "$notify_tool" ]]; then
                            local pct spend limit
                            pct="$(echo "$budget_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"{d.get(\"usage_percent\",0):.0f}")' 2>/dev/null || echo "?")"
                            spend="$(echo "$budget_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"{d.get(\"total_cost\",0):.2f}")' 2>/dev/null || echo "?")"
                            limit="$(echo "$budget_json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"{d.get(\"daily_limit\",0):.2f}")' 2>/dev/null || echo "?")"
                            "$notify_tool" "Budget at ${pct}% (\$${spend}/\$${limit})" --level warning >/dev/null 2>&1 || true
                            BUDGET_NOTIFIED_DATE="$today"
                            log_status "BUDGET" "Budget threshold notification sent (${pct}% used)"
                        fi
                    fi
                fi
            fi
        fi

        # Periodic pattern extraction (every PATTERN_EXTRACT_INTERVAL cycles ≈ 1 hour)
        ((PATTERN_EXTRACT_COUNTER++)) || true
        if ((PATTERN_EXTRACT_COUNTER >= PATTERN_EXTRACT_INTERVAL)); then
            PATTERN_EXTRACT_COUNTER=0
            local extract_tool="${SOREN_PROJECT_ROOT}/tools/extract-patterns"
            if [[ -x "$extract_tool" ]]; then
                # Guard: skip if already ran within the last 50 minutes
                local last_extract=0
                [[ -f "$PATTERN_EXTRACT_MARKER" ]] && last_extract=$(cat "$PATTERN_EXTRACT_MARKER" 2>/dev/null || echo 0)
                local now_ts
                now_ts=$(date +%s)
                if (( now_ts - last_extract >= 3000 )); then
                    (cd "${SOREN_PROJECT_ROOT}" && "$extract_tool" --commits 10 >/dev/null 2>&1) 202>&- &
                    echo "$now_ts" > "$PATTERN_EXTRACT_MARKER"
                    log_status "PATTERNS" "Pattern extraction triggered (background)"
                fi
            fi
        fi

        # Daily AMBITION verify-goal sweep (once per 24h)
        local verify_tool="${SOREN_PROJECT_ROOT}/tools/verify-goal"
        if [[ -x "$verify_tool" ]]; then
            local last_verify=0
            [[ -f "$VERIFY_SWEEP_MARKER" ]] && last_verify=$(cat "$VERIFY_SWEEP_MARKER" 2>/dev/null || echo 0)
            local now_verify
            now_verify=$(date +%s)
            if (( now_verify - last_verify >= 86400 )); then
                echo "$now_verify" > "$VERIFY_SWEEP_MARKER"
                local latest_ver
                latest_ver=$(grep -oP '(?<=^## AMBITION v)\d+' "${SOREN_PROJECT_ROOT}/.soren/AMBITION.md" 2>/dev/null | tail -1)
                if [[ -n "$latest_ver" ]]; then
                    (
                        cd "${SOREN_PROJECT_ROOT}"
                        if verify_out=$("$verify_tool" --version "$latest_ver" --json 2>&1); then
                            curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/journal/entry" \
                                -H "Content-Type: application/json" \
                                -d "{\"title\":\"verify-goal v${latest_ver}: PASS (daily sweep)\",\"content\":\"Daily verification sweep passed.\"}" \
                                >/dev/null 2>&1 || true
                            log_status "VERIFY" "Daily verify-goal v${latest_ver}: PASS"
                        else
                            local fail_n
                            fail_n=$(echo "$verify_out" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['stale'])" 2>/dev/null || echo "?")
                            curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/journal/entry" \
                                -H "Content-Type: application/json" \
                                -d "{\"title\":\"verify-goal v${latest_ver}: FAIL (daily sweep)\",\"content\":\"${fail_n} stale assertion(s) in daily sweep.\"}" \
                                >/dev/null 2>&1 || true
                            "${SOREN_PROJECT_ROOT}/tools/notify" "Daily verify-goal v${latest_ver}: ${fail_n} assertion(s) FAILED" --level warning 2>/dev/null || true
                            log_status "VERIFY" "Daily verify-goal v${latest_ver}: FAIL (${fail_n} stale)"
                        fi
                    ) 202>&- &
                fi
            fi
        fi

        # Daily health digest — once per day at hour 0
        local current_hour
        current_hour=$(date +%H)
        if [[ "$current_hour" == "00" ]]; then
            local digest_today
            digest_today=$(date +%Y-%m-%d)
            local last_digest=""
            [[ -f "$DAILY_DIGEST_MARKER" ]] && last_digest=$(cat "$DAILY_DIGEST_MARKER" 2>/dev/null || echo "")
            if [[ "$last_digest" != "$digest_today" ]]; then
                local scorecard_json budget_json digest_msg
                scorecard_json=$(curl -sf "http://localhost:${SOREN_PORT:-8000}/api/webhooks/scorecard" 2>/dev/null || echo "")
                budget_json=$(curl -sf "http://localhost:${SOREN_PORT:-8000}/api/budget/status" 2>/dev/null || echo "")
                if [[ -n "$scorecard_json" && -n "$budget_json" ]]; then
                    digest_msg=$(python3 -c "
import sys, json
s = json.loads('''${scorecard_json}''')
b = json.loads('''${budget_json}''')
uptime_h = s.get('uptime_seconds', 0) // 3600
tasks = s.get('tasks_completed_today', 0)
budget_pct = s.get('budget_usage_pct', 0)
active = s.get('agents_active', 0)
sleeping = s.get('agents_sleeping', 0)
spend = b.get('daily_spend_usd', 0)
limit = b.get('budget_limit_usd', 0)
print(f'Daily digest: {uptime_h}h uptime, {tasks} tasks done, budget {budget_pct}% (\${spend:.2f}/\${limit:.2f}), {active} active / {sleeping} sleeping agents')
" 2>/dev/null || echo "")
                    if [[ -n "$digest_msg" ]]; then
                        local notify_tool="${SOREN_PROJECT_ROOT}/tools/notify"
                        if [[ -x "$notify_tool" ]]; then
                            "$notify_tool" "$digest_msg" >/dev/null 2>&1 || true
                        fi
                        echo "$digest_today" > "$DAILY_DIGEST_MARKER"
                        curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/journal/entry" \
                            -H 'Content-Type: application/json' \
                            -d "{\"title\": \"Daily health digest\", \"content\": \"\", \"tags\": [\"digest\", \"automated\"]}" \
                            --max-time 5 >/dev/null 2>&1 || true
                        log_status "DIGEST" "Daily health digest sent"
                    fi
                fi
            fi
        fi

        sleep 5
    done
}

# Healthy commit tracking (absorbed from former health.sh)
HEALTHY_COMMIT_FILE=".soren/.last_healthy_commit"
RECOVERY_WAIT=30

# Rollback guardrail tunables
SOREN_HEALTHY_GRACE="${SOREN_HEALTHY_GRACE:-300}"                      # seconds a new HEAD must run healthy before being marked
SOREN_MAX_GIT_RECOVERIES_PER_HOUR="${SOREN_MAX_GIT_RECOVERIES_PER_HOUR:-3}"  # circuit breaker for git-mutating recovery stages
SOREN_RESCUE_BRANCH_KEEP="${SOREN_RESCUE_BRANCH_KEEP:-10}"             # rescue branches to retain
HEAD_FIRST_SEEN_FILE=".soren/run/head-first-seen"
RECOVERY_EVENTS_FILE=".soren/run/recovery-events.log"

mark_healthy() {
    local commit
    commit=$(git rev-parse HEAD 2>/dev/null || echo "")
    if [[ -n "$commit" ]]; then
        echo "$commit" > "$HEALTHY_COMMIT_FILE"
        # Warn when the "healthy" state depends on uncommitted tracked changes —
        # rolling back to this commit will NOT reproduce the running state.
        if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
            _orch_log "[HEALTH] WARNING: marked ${commit:0:8} healthy with dirty tracked files — rollback to it may not reproduce running state"
        fi
    fi
}

# Continuously advance the healthy pointer during NORMAL operation.
# A new HEAD is only marked healthy after it has been running (and passing
# health checks) for SOREN_HEALTHY_GRACE seconds — a bad commit that takes a
# few minutes to fall over never becomes a rollback target.
mark_healthy_if_stable() {
    local head recorded now first_seen
    head=$(git rev-parse HEAD 2>/dev/null) || return 0
    recorded=$(cat "$HEALTHY_COMMIT_FILE" 2>/dev/null || echo "")
    [[ "$head" == "$recorded" ]] && return 0

    now=$(date +%s)
    mkdir -p "$(dirname "$HEAD_FIRST_SEEN_FILE")"
    local seen_sha seen_ts
    read -r seen_sha seen_ts < "$HEAD_FIRST_SEEN_FILE" 2>/dev/null || true
    if [[ "${seen_sha:-}" != "$head" ]]; then
        echo "$head $now" > "$HEAD_FIRST_SEEN_FILE"
        return 0
    fi
    first_seen="${seen_ts:-$now}"
    if (( now - first_seen >= SOREN_HEALTHY_GRACE )); then
        mark_healthy
        log_status "HEALTH" "Healthy pointer advanced to ${head:0:8} (stable ${SOREN_HEALTHY_GRACE}s)"
    fi
}

get_last_healthy_commit() {
    if [[ -f "$HEALTHY_COMMIT_FILE" ]]; then
        cat "$HEALTHY_COMMIT_FILE"
    else
        _orch_log "[ROLLBACK] WARNING: no recorded healthy commit — falling back to HEAD~1 (arbitrary)"
        git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD
    fi
}

# ── Recovery circuit breaker ──────────────────────────────────────────────────
# Git-mutating recovery (stages 2-4) is rate-limited. A flapping failure that
# survives rollbacks (bad dependency, disk full, provider outage) must not
# thrash the repository in a loop.
_record_git_recovery() {
    mkdir -p "$(dirname "$RECOVERY_EVENTS_FILE")"
    date +%s >> "$RECOVERY_EVENTS_FILE"
}

_git_recoveries_last_hour() {
    [[ -f "$RECOVERY_EVENTS_FILE" ]] || { echo 0; return; }
    local now cutoff count=0 ts
    now=$(date +%s)
    cutoff=$((now - 3600))
    while IFS= read -r ts; do
        [[ -n "$ts" && "$ts" -ge "$cutoff" ]] && count=$((count+1))
    done < "$RECOVERY_EVENTS_FILE"
    # Compact the file while we're here
    if (( count < $(wc -l < "$RECOVERY_EVENTS_FILE") )); then
        local tmp; tmp=$(mktemp)
        awk -v c="$cutoff" '$1 >= c' "$RECOVERY_EVENTS_FILE" > "$tmp" && mv "$tmp" "$RECOVERY_EVENTS_FILE"
    fi
    echo "$count"
}

# Deeper post-recovery verification. Uses tools/smoke-test only when smoke
# credentials exist (without them auth-gated tests count as failures and every
# recovery stage would wrongly "fail"); otherwise the health endpoint decides.
deep_health_check() {
    if ! is_server_running; then
        return 1
    fi
    if [[ -x "${SOREN_PROJECT_ROOT}/tools/smoke-test" ]] \
        && [[ -n "${SOREN_SMOKE_TOKEN:-}${SOREN_SMOKE_USER:-}" ]]; then
        "${SOREN_PROJECT_ROOT}/tools/smoke-test" --url "http://localhost:${SOREN_PORT}" 2>/dev/null
        return $?
    fi
    return 0
}

# Snapshot everything reachable before any history-mutating git operation.
# Prints the rescue branch name. Never fails the caller.
create_rescue_snapshot() {
    local ts branch
    ts=$(date +%s)
    branch="soren/pre-rollback-${ts}"
    git branch "$branch" HEAD >/dev/null 2>&1 || branch=""
    # Stash tracked AND untracked dirt so nothing is lost to reset --hard
    git stash push -u -m "soren-auto-rollback-${ts}" >/dev/null 2>&1 || true
    # Prune old rescue branches beyond the retention window (BSD-safe)
    local branches total excess old
    branches=$(git for-each-ref --format='%(refname:short)' refs/heads/soren/pre-rollback-* 2>/dev/null | sort)
    total=$(printf '%s\n' "$branches" | grep -c . || true)
    excess=$(( total - SOREN_RESCUE_BRANCH_KEEP ))
    if (( excess > 0 )); then
        printf '%s\n' "$branches" | head -n "$excess" | while IFS= read -r old; do
            [[ -n "$old" ]] && git branch -D "$old" 2>/dev/null || true
        done
    fi
    echo "$branch"
}

# Journal the failure context before rollback
pre_rollback_journal() {
    local error_log="$1"
    local git_status last_commit target_commit
    git_status=$(git status --short 2>/dev/null || echo "Unable to get git status")
    last_commit=$(git log -1 --oneline 2>/dev/null || echo "Unable to get last commit")
    target_commit=$(get_last_healthy_commit)

    curl -sf -X POST "http://localhost:${SOREN_PORT}/api/journal/entry" \
        -H "Content-Type: application/json" \
        -d "{
            \"title\": \"Auto-Rollback Triggered\",
            \"content\": \"## Health Check Failure\\n\\nHealth check failed after ${MAX_FAILURES} consecutive retries. Auto-rollback initiated.\\n\\n### Error Context\\n\\\`\\\`\\\`\\n${error_log}\\n\\\`\\\`\\\`\\n\\n### Git Status\\n\\\`\\\`\\\`\\n${git_status}\\n\\\`\\\`\\\`\\n\\n### Last Commit\\n${last_commit}\\n\\n### Rolling Back To\\n${target_commit}\"
        }" 2>/dev/null || true

    # Also write to local file as backup (API may be down)
    local journal_dir=".soren/journal/$(date +%Y-%m-%d)"
    mkdir -p "$journal_dir"
    cat > "${journal_dir}/rollback-$(date +%H%M%S).md" << ROLLBACK_EOF
# Auto-Rollback Triggered

**Time:** $(date -Iseconds)

## Health Check Failure

Health check failed after ${MAX_FAILURES} consecutive retries. Auto-rollback initiated.

### Error Context
\`\`\`
${error_log}
\`\`\`

### Git Status
\`\`\`
${git_status}
\`\`\`

### Last Commit
${last_commit}

### Rolling Back To
${target_commit}
ROLLBACK_EOF
}

# Notify supervisor of rollback via mailbox and tmux
notify_supervisor_of_rollback() {
    local error_context="$1"
    local target_commit="$2"
    local message="SYSTEM ALERT: Auto-rollback to ${target_commit}. Error: ${error_context}. Check .soren/journal/$(date +%Y-%m-%d)/."

    # Send via mailbox in JSONL format (router expects JSONL, not plaintext)
    local msg_id msg_ts
    msg_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "rollback-$(date +%s)")
    msg_ts=$(date -u +%FT%TZ)
    printf '{"id":"%s","ts":"%s","from":"system:health","to":"soren:supervisor","type":"ERROR","body":"Auto-rollback to %s — %s","status":"submitted"}\n' \
        "$msg_id" "$msg_ts" "$target_commit" "$error_context" >> "${SOREN_MAILBOX}" 2>/dev/null || true

    # Also send directly to tmux for immediate attention
    if tmux_window_exists "$SOREN_SESSION" "supervisor"; then
        tmux_safe_send "$SOREN_SESSION" "supervisor" "$message" --force
    fi
}

# Stop the server by killing processes on SOREN_PORT
stop_server() {
    local pids
    pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
    if [[ -n "$pids" ]]; then
        for pid in $pids; do
            kill "$pid" 2>/dev/null || true
        done
        # Wait for graceful shutdown
        local wait_count=0
        while lsof -ti tcp:"$SOREN_PORT" >/dev/null 2>&1 && ((wait_count < 5)); do
            sleep 1
            ((wait_count++))
        done
        # Force kill remaining
        pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null || true
            done
        fi
    fi
    pkill -f "uvicorn.*src.server.main:app" 2>/dev/null || true
}

# Rollback to a specific commit, rebuild deps, restart server
rollback_and_restart() {
    local target_commit="$1"
    log_step "Rolling back to commit ${target_commit}"

    cd "$SOREN_PROJECT_ROOT"

    # Refuse to mutate history from an abnormal repo state — a reset --hard
    # mid-merge/rebase can corrupt agent work in ways a stash won't rescue.
    local git_dir
    git_dir=$(git rev-parse --git-dir 2>/dev/null || echo ".git")
    if [[ -e "${git_dir}/MERGE_HEAD" || -e "${git_dir}/rebase-merge" || -e "${git_dir}/rebase-apply" ]]; then
        log_warn "Repo is mid-merge/rebase — aborting it before rollback"
        git merge --abort 2>/dev/null || git rebase --abort 2>/dev/null || true
    fi

    # Sanity: the target must exist and be an ancestor of HEAD (or HEAD itself)
    if ! git cat-file -e "${target_commit}^{commit}" 2>/dev/null; then
        log_fail "Rollback target ${target_commit} does not exist — refusing"
        return 1
    fi

    # Warn the supervisor BEFORE files change under running agents
    if tmux_window_exists "$SOREN_SESSION" "supervisor"; then
        tmux_safe_send "$SOREN_SESSION" "supervisor" \
            "[SYS] SYSTEM ALERT: auto-rollback to ${target_commit:0:8} starting NOW. Pause all workers; repo files are about to change." --force || true
    fi

    # Belt-and-suspenders: backup .soren/ runtime data before git reset --hard.
    # The .gitignore should protect these files, but if something goes wrong
    # (e.g., .gitignore itself gets rolled back), this backup ensures recovery.
    local backup_dir="/tmp/soren-rollback-backup-$(date +%s)"
    if cp -a .soren/ "$backup_dir" 2>/dev/null; then
        log_step "Runtime data backed up to ${backup_dir}"
    else
        log_warn "Failed to backup .soren/ — proceeding anyway"
    fi

    # Rescue snapshot: branch at current HEAD + stash (incl. untracked).
    # Nothing an agent committed or wrote is ever unreachable after rollback.
    local rescue_branch
    rescue_branch=$(create_rescue_snapshot)
    if [[ -n "$rescue_branch" ]]; then
        log_step "Pre-rollback state preserved on branch ${rescue_branch}"
        _orch_log "[ROLLBACK] Rescue branch: ${rescue_branch} (restore: git merge ${rescue_branch} / git stash list)"
    else
        log_warn "Could not create rescue branch — reflog is the only recovery path"
    fi

    git reset --hard "$target_commit" 2>/dev/null || return 1

    # Restore runtime data that git reset may have clobbered
    if [[ -d "$backup_dir" ]]; then
        # Restore databases, journals, agent registry, mailbox, and daemon state
        # NOTE: *.pid and *.lock files in run/ are intentionally excluded —
        # daemons must create fresh state on startup to avoid stale lock contention.
        for item in journal agent_registry.db agent_registry.db-shm agent_registry.db-wal \
                    agent_registry.json conversations.db memories.db messages.db tasks.db \
                    auth.db mailbox worker-contexts .compact-timestamps \
                    .supervisor-heartbeat .sup-site-heartbeat .last_healthy_commit \
                    .router_line .router_position .log_markers .fix-retries \
                    .ui-check-flags .reminder-sent-ids .auth-secret mailbox-archive; do
            if [[ -e "${backup_dir}/${item}" ]]; then
                cp -a "${backup_dir}/${item}" ".soren/${item}" 2>/dev/null || true
            fi
        done
        # Restore run/ directory but purge stale PID and lock files
        if [[ -d "${backup_dir}/run" ]]; then
            cp -a "${backup_dir}/run" ".soren/run" 2>/dev/null || true
            rm -f .soren/run/*.pid .soren/run/*.lock 2>/dev/null || true
        fi
        log_step "Runtime data restored from backup (PID/lock files excluded)"
    fi

    # Rebuild dependencies
    uv sync 2>/dev/null || log_warn "uv sync failed, continuing..."
    (cd "${SOREN_PROJECT_ROOT}/src/frontend" && npm ci --silent 2>/dev/null && npm run build 2>/dev/null) || log_warn "Frontend rebuild failed, continuing..."

    # Kill stale daemons before restart to prevent duplicates after rollback
    cleanup_stale_daemons 2>/dev/null || true

    stop_server
    start_server

    # Post-restart health verification
    local health_ok=false
    local health_retries=3
    while ((health_retries > 0)); do
        sleep 5
        if is_server_running; then
            health_ok=true
            break
        fi
        log_warn "Post-rollback health check failed (${health_retries} retries left)"
        ((health_retries--))
    done

    if [[ "$health_ok" == true ]]; then
        log_ok "Post-rollback health check passed"
    else
        log_fail "CRITICAL: Server unhealthy after rollback to ${target_commit}"
        _orch_log "[ROLLBACK] CRITICAL: Server still unhealthy after rollback + 3 health retries"
    fi

    # Log rollback to failure API
    curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/messages/verify-result" \
      -H "Content-Type: application/json" \
      -d "{
        \"agent_id\": \"monitor\",
        \"result\": \"verify-failed\",
        \"commit_sha\": \"$(git rev-parse HEAD 2>/dev/null || echo unknown)\",
        \"details\": \"Monitor rollback triggered after health check failures\"
      }" >/dev/null 2>&1 || true
}

# Try a targeted git revert of HEAD before falling back to full rollback.
# Preserves unrelated good commits when a single bad commit caused the failure.
# Returns 0 if the targeted revert restored health, 1 if it did not.
try_targeted_revert() {
    local error_log="$1"

    # Show recent commits for context in the orchestrator log
    local recent_commits
    recent_commits=$(git log --oneline HEAD~5..HEAD 2>/dev/null || echo "(unable to get recent commits)")
    log_step "Recent commits (HEAD~5..HEAD):"
    while IFS= read -r commit_line; do
        [[ -n "$commit_line" ]] && log_warn "  ${commit_line}"
    done <<< "$recent_commits"
    _orch_log "[TARGETED_REVERT] Recent commits: ${recent_commits}"

    # Save current HEAD so we can undo if the revert doesn't help
    local pre_revert_sha
    pre_revert_sha=$(git rev-parse HEAD 2>/dev/null) || return 1

    # Attempt targeted revert of HEAD
    log_step "Attempting targeted revert of HEAD (${pre_revert_sha:0:8})..."
    _orch_log "[TARGETED_REVERT] git revert HEAD --no-edit on ${pre_revert_sha}"

    if ! git revert HEAD --no-edit 2>/dev/null; then
        log_warn "git revert HEAD failed (merge conflict or empty diff) — skipping targeted revert"
        _orch_log "[TARGETED_REVERT] git revert failed"
        git revert --abort 2>/dev/null || true
        return 1
    fi

    local revert_sha
    revert_sha=$(git rev-parse HEAD 2>/dev/null)
    log_step "Revert commit created (${revert_sha:0:8}) — rebuilding and restarting..."
    _orch_log "[TARGETED_REVERT] Revert commit: ${revert_sha}"

    # Rebuild deps + restart so smoke test reflects the reverted code
    uv sync 2>/dev/null || log_warn "uv sync failed after revert, continuing..."
    (cd "${SOREN_PROJECT_ROOT}/src/frontend" && npm ci --silent 2>/dev/null && npm run build 2>/dev/null) \
        || log_warn "Frontend rebuild failed after revert, continuing..."
    stop_server
    start_server
    sleep "$RECOVERY_WAIT"

    # Verify the revert actually fixed things. deep_health_check only uses
    # tools/smoke-test when smoke credentials are configured — without them
    # its auth-gated tests count as failures and this stage could never pass.
    log_step "Verifying health after targeted revert..."
    if deep_health_check; then
        log_ok "Targeted revert successful — smoke tests pass (${revert_sha:0:8})"
        log_status "RECOVERY" "Stage 2 SUCCESS: Targeted revert ${revert_sha} restored health"
        _orch_log "[TARGETED_REVERT] SUCCESS: Smoke tests pass after revert"
        notify_supervisor_of_rollback \
            "Targeted revert of bad commit ${pre_revert_sha}" "${revert_sha}"
        return 0
    fi

    # Revert didn't fix it — undo the revert commit and let caller fall through to full rollback
    log_warn "Targeted revert did not restore health — undoing revert and falling back to full rollback"
    _orch_log "[TARGETED_REVERT] FAILED: Smoke tests still fail after revert"
    git reset --hard "$pre_revert_sha" 2>/dev/null || true
    return 1
}

attempt_recovery() {
    log_step "Attempting server recovery (multi-stage)..."
    log_status "RECOVERY" "Starting multi-stage server recovery"

    # Capture recent server log for context
    local error_log
    error_log=$(tail -50 "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" 2>/dev/null || echo "No server log available")
    _orch_log "[RECOVERY] Server log tail: ${error_log}"

    # Run root cause analysis — identify the specific bad change before recovery
    local rca_json=""
    if [[ -f "${SOREN_PROJECT_ROOT}/tools/root-cause" ]]; then
        # Write error log to a temp file so root-cause can read it
        local rca_tmp="${SOREN_PROJECT_ROOT}/.soren/run/rca-recovery-errorlog.txt"
        mkdir -p "${SOREN_PROJECT_ROOT}/.soren/run"
        printf '%s' "$error_log" > "$rca_tmp"
        rca_json=$(cd "${SOREN_PROJECT_ROOT}" && tools/root-cause --error-log "$rca_tmp" 2>/dev/null || echo "")
        rm -f "$rca_tmp"
        if [[ -n "$rca_json" ]]; then
            _orch_log "[RECOVERY] Root cause analysis: ${rca_json}"
            # Store in failure_log via API
            local commit_sha
            commit_sha=$(git -C "${SOREN_PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "")
            curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/agents/failures" \
                -H "Content-Type: application/json" \
                -d "{\"agent_id\":\"monitor\",\"failure_type\":\"runtime_crash\",\"description\":\"Server health check failure requiring recovery\",\"commit_sha\":\"${commit_sha}\",\"root_cause\":$(echo "$rca_json" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read().strip()))' 2>/dev/null || echo 'null')}" \
                >/dev/null 2>&1 || true
        fi
    fi

    # Notify user that recovery has been triggered
    local current_commit
    current_commit=$(git -C "${SOREN_PROJECT_ROOT}" rev-parse --short HEAD 2>/dev/null || echo "unknown")
    local notify_tool="${SOREN_PROJECT_ROOT}/tools/notify"
    if [[ -x "$notify_tool" ]]; then
        "$notify_tool" "Recovery triggered at ${current_commit} — server health check failed" --level alert >/dev/null 2>&1 || true
    fi

    # Stage 1: Simple restart
    log_step "Stage 1: Simple restart..."
    log_status "RECOVERY" "Stage 1: Attempting simple restart"
    stop_server
    sleep 2
    if start_server && is_server_running; then
        log_ok "Recovery successful (simple restart)"
        log_status "RECOVERY" "Stage 1 SUCCESS: Simple restart worked"
        mark_healthy
        HEALTH_FAILURES=0
        return
    fi
    log_status "RECOVERY" "Stage 1 FAILED: Simple restart did not work"

    # Circuit breaker: git-mutating recovery is rate-limited. If rollbacks are
    # not fixing the problem, the problem is not in git history — stop
    # thrashing the repository and demand a human.
    local git_recoveries
    git_recoveries=$(_git_recoveries_last_hour)
    if (( git_recoveries >= SOREN_MAX_GIT_RECOVERIES_PER_HOUR )); then
        log_fail "CIRCUIT BREAKER: ${git_recoveries} git recoveries in the last hour (max ${SOREN_MAX_GIT_RECOVERIES_PER_HOUR}) — refusing further rollbacks"
        log_status "RECOVERY" "CIRCUIT BREAKER OPEN: manual intervention required (${git_recoveries} git recoveries/hour)"
        [[ -x "$notify_tool" ]] && "$notify_tool" \
            "SOREN circuit breaker OPEN: ${git_recoveries} rollbacks in 1h did not restore health. Rollbacks suspended — investigate manually." \
            --level alert >/dev/null 2>&1 || true
        notify_supervisor_of_rollback \
            "Circuit breaker open: repeated rollbacks are not fixing the failure. Likely non-code cause (deps, disk, provider, env). Rollbacks suspended for this hour." "SUSPENDED"
        return
    fi
    _record_git_recovery

    # Journal the failure context once, before any git operations
    pre_rollback_journal "$error_log"

    # Stage 2: Targeted revert — revert HEAD commit and smoke-test
    # Preserves unrelated good commits; only falls through if revert can't fix it.
    log_step "Stage 2: Targeted revert of HEAD commit..."
    log_status "RECOVERY" "Stage 2: Attempting targeted git revert"
    if try_targeted_revert "$error_log"; then
        HEALTH_FAILURES=0
        return
    fi
    log_status "RECOVERY" "Stage 2 FAILED: Targeted revert did not restore health"

    # Stage 3: Full rollback to last healthy commit
    local target_commit
    target_commit=$(get_last_healthy_commit)
    log_step "Stage 3: Full rollback to last healthy commit (${target_commit})..."
    log_status "RECOVERY" "Stage 3: Rolling back to ${target_commit}"
    rollback_and_restart "$target_commit"

    sleep "$RECOVERY_WAIT"

    if deep_health_check; then
        log_ok "Recovery successful (rollback to $target_commit)"
        log_status "RECOVERY" "Stage 3 SUCCESS: Rollback to ${target_commit} worked"
        notify_supervisor_of_rollback "$error_log" "$target_commit"
        HEALTH_FAILURES=0
        return
    fi
    log_status "RECOVERY" "Stage 3 FAILED: Rollback to ${target_commit} did not work"

    # Stage 4: Try progressively older commits
    log_step "Stage 4: Trying older commits..."
    log_status "RECOVERY" "Stage 4: Trying progressively older commits"
    local commits
    commits=$(git log --oneline -10 | tail -n +2)

    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local commit_hash
        commit_hash=$(echo "$line" | cut -d' ' -f1)

        log_step "Trying rollback to $commit_hash..."
        log_status "RECOVERY" "Stage 4: Trying commit ${commit_hash}"
        rollback_and_restart "$commit_hash"

        sleep "$RECOVERY_WAIT"

        if deep_health_check; then
            log_ok "Recovery successful (rollback to $commit_hash)"
            log_status "RECOVERY" "Stage 4 SUCCESS: Rollback to ${commit_hash} worked"
            notify_supervisor_of_rollback "$error_log" "$commit_hash"
            HEALTH_FAILURES=0
            return
        fi
        log_status "RECOVERY" "Stage 4: Commit ${commit_hash} failed, trying next"
    done <<< "$commits"

    log_fail "All recovery attempts failed - manual intervention required"
    log_status "RECOVERY" "ALL STAGES FAILED: Manual intervention required"
    notify_supervisor_of_rollback "All rollback attempts failed. Manual intervention required." "NONE"
}

#───────────────────────────────────────────────────────────────────────────────
# Startup Cleanup
#───────────────────────────────────────────────────────────────────────────────

# Kill stale daemon processes from previous monitor runs.
# Reads PID files in .soren/run/, kills processes that aren't us,
# then writes our own PID. Also kills any monitor.sh older than 1 hour.
cleanup_stale_daemons() {
    local run_dir="${SOREN_PROJECT_ROOT}/.soren/run"
    mkdir -p "$run_dir"

    # Kill processes tracked in PID files (except self)
    local pid_file
    for pid_file in "$run_dir"/*.pid; do
        [[ -f "$pid_file" ]] || continue
        local old_pid
        old_pid=$(cat "$pid_file" 2>/dev/null || echo "")
        [[ -z "$old_pid" ]] && continue
        # Skip self
        [[ "$old_pid" == "$$" ]] && continue
        # Check if process is still running
        if kill -0 "$old_pid" 2>/dev/null; then
            local basename_pid
            basename_pid=$(basename "$pid_file" .pid)
            _orch_log "[CLEANUP] Killing stale ${basename_pid} process (PID: ${old_pid})"
            kill "$old_pid" 2>/dev/null || true
            # Give it a moment, then force kill if needed
            sleep 1
            if kill -0 "$old_pid" 2>/dev/null; then
                kill -9 "$old_pid" 2>/dev/null || true
            fi
        fi
        rm -f "$pid_file"
    done

    # Belt-and-suspenders: kill any monitor.sh processes older than 1 hour (except self)
    local stale_monitors
    stale_monitors=$(ps -eo pid,etimes,args 2>/dev/null | grep 'monitor\.sh' | grep -v grep | awk '$2 > 3600 {print $1}' || true)
    for pid in $stale_monitors; do
        [[ "$pid" == "$$" ]] && continue
        _orch_log "[CLEANUP] Killing old monitor.sh (PID: ${pid}, >1h old)"
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
    done

    # Also kill stale router.sh processes not tracked by PID files
    local stale_routers
    stale_routers=$(ps -eo pid,etimes,args 2>/dev/null | grep 'router\.sh' | grep -v grep | awk '$2 > 3600 {print $1}' || true)
    for pid in $stale_routers; do
        _orch_log "[CLEANUP] Killing old router.sh (PID: ${pid}, >1h old)"
        kill "$pid" 2>/dev/null || true
    done

    # Write our own PID
    echo "$$" > "$run_dir/monitor.pid"
    _orch_log "[CLEANUP] Stale daemon cleanup complete, monitor PID $$ registered"
}

# Expire mailbox messages older than 48 hours with 'submitted' status.
# Uses a temp file and atomic mv for safety.
cleanup_stale_mailbox() {
    local mailbox="${SOREN_PROJECT_ROOT}/${SOREN_MAILBOX}"
    [[ -f "$mailbox" ]] || return 0

    local now_epoch
    now_epoch=$(date +%s)
    local ttl_seconds=$((48 * 3600))  # 48 hours
    local tmp_file="${mailbox}.cleanup.tmp"
    local expired_count=0

    # Process each line
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        local status ts
        status=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.readline()); print(d.get('status',''))" 2>/dev/null || echo "")
        ts=$(echo "$line" | python3 -c "
import sys, json
from datetime import datetime, timezone
d = json.loads(sys.stdin.readline())
ts = d.get('ts', '')
try:
    if ts.endswith('Z'):
        ts = ts[:-1] + '+00:00'
    dt = datetime.fromisoformat(ts)
    print(int(dt.timestamp()))
except:
    print(0)
" 2>/dev/null || echo "0")

        if [[ "$status" == "submitted" && "$ts" -gt 0 ]]; then
            local age=$((now_epoch - ts))
            if ((age > ttl_seconds)); then
                # Replace status with 'expired'
                local updated_line
                updated_line=$(echo "$line" | python3 -c "import sys,json; d=json.loads(sys.stdin.readline()); d['status']='expired'; print(json.dumps(d))" 2>/dev/null || echo "$line")
                echo "$updated_line" >> "$tmp_file"
                ((expired_count++))
                continue
            fi
        fi
        echo "$line" >> "$tmp_file"
    done < "$mailbox"

    if [[ -f "$tmp_file" ]]; then
        mv "$tmp_file" "$mailbox"
    fi

    if ((expired_count > 0)); then
        _orch_log "[CLEANUP] Expired ${expired_count} stale mailbox message(s) (>48h, status=submitted)"
    fi
}

#───────────────────────────────────────────────────────────────────────────────
# Main
#───────────────────────────────────────────────────────────────────────────────

main() {
    cd "$SOREN_PROJECT_ROOT"

    # Ensure directories exist
    mkdir -p "$(dirname "$SOREN_MAILBOX")"
    mkdir -p "$(dirname "$ROUTER_LOG")"

    # Rotate orchestrator log if needed
    _maybe_rotate_orch_log

    # Log startup environment for crash diagnosis
    log_status "STARTUP" "=== SOREN Monitor starting ==="
    _orch_log "============================================================"
    _orch_log "[STARTUP] SOREN Monitor starting"
    _orch_log "[STARTUP] PID: $$"
    _orch_log "[STARTUP] Project root: ${SOREN_PROJECT_ROOT}"
    _orch_log "[STARTUP] Session: ${SOREN_SESSION}"
    _orch_log "[STARTUP] Server: ${SOREN_HOST}:${SOREN_PORT}"
    _orch_log "[STARTUP] Git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
    _orch_log "[STARTUP] Git branch: $(git branch --show-current 2>/dev/null || echo 'unknown')"
    _orch_log "[STARTUP] tmux version: $(tmux -V 2>/dev/null || echo 'unknown')"
    _orch_log "[STARTUP] opencode version: $(opencode --version 2>/dev/null || echo 'unknown')"
    _orch_log "[STARTUP] uv version: $(uv --version 2>/dev/null || echo 'unknown')"
    _orch_log "[STARTUP] node version: $(node --version 2>/dev/null || echo 'unknown')"
    _orch_log "============================================================"

    # Clean up stale daemon processes from previous runs
    cleanup_stale_daemons

    # Expire old mailbox messages (>48h, submitted)
    cleanup_stale_mailbox

    # Clean up stale sentry lockfile (lockfile exists but no sentry window)
    if [[ -f "$SENTRY_ACTIVE_FILE" ]] && ! tmux_window_exists "$SOREN_SESSION" "sentry" 2>/dev/null; then
        _orch_log "[STARTUP] Cleaned stale sentry lockfile"
        rm -f "$SENTRY_ACTIVE_FILE"
    fi

    print_banner
    print_separator

    # Phase 1: Start server
    start_server || exit 1
    echo ""

    # Phase 1b: Index memory store (background, non-blocking)
    local memory_tool="${SOREN_PROJECT_ROOT}/tools/memory-index"
    if [[ -x "$memory_tool" ]]; then
        log_step "Indexing memory store (background)..."
        "$memory_tool" >/dev/null 2>&1 202>&- &
        log_ok "Memory indexing started"
    fi
    echo ""

    # Phase 2: Launch supervisor
    launch_supervisor || log_warn "Supervisor launch failed — will retry in dashboard loop"
    echo ""

    # Phase 2b: Launch project supervisors for active projects
    launch_project_supervisors || log_warn "Some project supervisors failed to launch"
    echo ""

    # Phase 3: Start router in background
    start_router || log_warn "Router failed to start — will retry in dashboard loop"
    echo ""

    # Phase 3b: Respawn permanent workers that are missing
    respawn_permanent_workers || log_warn "Some permanent workers failed to respawn"
    echo ""

    # Phase 4: Start log watcher in background
    start_log_watcher || log_warn "Log watcher failed to start"
    echo ""

    # Phase 5: Start journal nudge daemon
    start_journal_nudge || log_warn "Journal nudge failed to start"
    echo ""

    # Phase 6: Start compact daemon
    start_compact_daemon || log_warn "Compact daemon failed to start"
    echo ""

    # Phase 7: Run health dashboard (foreground)
    log_ok "Entering dashboard mode..."
    sleep 2
    run_dashboard
}

main
