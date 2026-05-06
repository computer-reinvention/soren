#!/usr/bin/env bash
# Detached restart script for supervisor-triggered restarts/rollbacks
# This script runs fully detached so the calling process can exit safely

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/logging.sh"

# Configuration
SOREN_PORT="${SOREN_PORT:-8000}"
SOREN_PROJECT_ROOT="${SOREN_PROJECT_ROOT:-$(pwd)}"
LOG_FILE=".soren/detached-restart.log"

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Log to both file and status log
log_detached() {
    local level="$1"
    shift
    local message="$*"
    local timestamp
    timestamp=$(date -Iseconds)
    echo "${timestamp} [${level}] ${message}" >> "$LOG_FILE"
    log_status "$level" "$message"
}

show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Options:
  --restart              Restart the FastAPI server only
  --rollback [commit]    Rollback to specified commit and restart
                         If no commit specified, rolls back to HEAD~1
  --detach               Run in background (nohup + disown)
  -h, --help             Show this help message

Examples:
  $0 --restart --detach
  $0 --rollback abc1234 --detach
  $0 --rollback --detach
EOF
}

stop_server() {
    log_detached "IN_PROGRESS" "Stopping server on port ${SOREN_PORT}..."

    local pids
    pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)

    if [[ -n "$pids" ]]; then
        # SIGTERM first (graceful shutdown)
        for pid in $pids; do
            kill "$pid" 2>/dev/null && log_detached "INFO" "Sent SIGTERM to PID $pid"
        done

        # Wait up to 5 seconds for graceful shutdown
        local wait_count=0
        while lsof -ti tcp:"$SOREN_PORT" >/dev/null 2>&1 && ((wait_count < 5)); do
            sleep 1
            ((wait_count++))
        done

        # SIGKILL any remaining
        pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            for pid in $pids; do
                kill -9 "$pid" 2>/dev/null && log_detached "INFO" "Force killed PID $pid"
            done
        fi
    fi

    # Fallback: kill by process name
    pkill -f "uvicorn.*src.server.main:app" 2>/dev/null || true

    log_detached "COMPLETE" "Server stopped"
}

start_server() {
    log_detached "IN_PROGRESS" "Starting server..."

    cd "$SOREN_PROJECT_ROOT"
    mkdir -p "${SOREN_PROJECT_ROOT}/.soren/logs" "${SOREN_PROJECT_ROOT}/.soren/run"
    nohup uv run uvicorn src.server.main:app \
        --host "0.0.0.0" \
        --port "$SOREN_PORT" \
        > "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" 2>&1 &

    # Wait for server to be ready
    local wait_count=0
    local max_wait=30
    while ! curl -sf "http://localhost:${SOREN_PORT}/api/webhooks/health" >/dev/null 2>&1; do
        sleep 1
        ((wait_count++))
        if ((wait_count >= max_wait)); then
            log_detached "FAILED" "Server failed to start within ${max_wait} seconds"
            return 1
        fi
    done

    log_detached "COMPLETE" "Server started successfully"
}

rebuild_deps() {
    log_detached "IN_PROGRESS" "Rebuilding dependencies..."

    cd "$SOREN_PROJECT_ROOT"

    # Python dependencies
    log_detached "INFO" "Installing Python dependencies..."
    uv sync >> "$LOG_FILE" 2>&1

    # Frontend dependencies and build
    log_detached "INFO" "Building frontend..."
    (cd src/frontend && npm install >> "$LOG_FILE" 2>&1 && npm run build >> "$LOG_FILE" 2>&1)

    log_detached "COMPLETE" "Dependencies rebuilt"
}

do_rollback() {
    local target_commit="$1"

    log_detached "IN_PROGRESS" "Rolling back to commit ${target_commit}..."

    cd "$SOREN_PROJECT_ROOT"

    # Stash any uncommitted changes (preserves work for later recovery)
    git stash push -m "soren-detached-rollback-$(date +%s)" 2>/dev/null || true

    # Reset to target commit
    if ! git reset --hard "$target_commit" >> "$LOG_FILE" 2>&1; then
        log_detached "FAILED" "Git reset failed"
        return 1
    fi

    log_detached "COMPLETE" "Rolled back to ${target_commit}"
}

do_restart() {
    log_detached "IN_PROGRESS" "Performing restart..."

    stop_server
    sleep 2
    start_server

    log_detached "COMPLETE" "Restart complete"
}

do_rollback_and_restart() {
    local target_commit="$1"

    log_detached "IN_PROGRESS" "Performing rollback and restart to ${target_commit}..."

    stop_server
    do_rollback "$target_commit"
    rebuild_deps
    start_server

    log_detached "COMPLETE" "Rollback and restart complete"
}

# Main execution for detached mode
run_detached() {
    local action="$1"
    local commit="${2:-}"

    # Wait 2 seconds so the caller can exit
    sleep 2

    log_detached "INFO" "Detached restart initiated (action: ${action}, commit: ${commit:-N/A})"

    case "$action" in
        restart)
            do_restart
            ;;
        rollback)
            if [[ -z "$commit" ]]; then
                commit=$(git rev-parse HEAD~1 2>/dev/null || echo "")
                if [[ -z "$commit" ]]; then
                    log_detached "FAILED" "Could not determine rollback target"
                    exit 1
                fi
            fi
            do_rollback_and_restart "$commit"
            ;;
        *)
            log_detached "FAILED" "Unknown action: ${action}"
            exit 1
            ;;
    esac

    log_detached "COMPLETE" "Detached restart finished successfully"
}

main() {
    local action=""
    local commit=""
    local detach=false

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --restart)
                action="restart"
                shift
                ;;
            --rollback)
                action="rollback"
                shift
                # Check if next arg is a commit hash (not a flag)
                if [[ $# -gt 0 && ! "$1" =~ ^-- ]]; then
                    commit="$1"
                    shift
                fi
                ;;
            --detach)
                detach=true
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done

    # Validate arguments
    if [[ -z "$action" ]]; then
        echo "Error: Must specify --restart or --rollback"
        show_usage
        exit 1
    fi

    # Change to project root
    cd "$SOREN_PROJECT_ROOT"

    if [[ "$detach" == true ]]; then
        # Run in background, fully detached
        log_info "Launching detached restart (action: ${action})..."
        nohup "$0" --internal-run "$action" "$commit" >> "$LOG_FILE" 2>&1 &
        disown
        log_info "Detached restart launched. Check $LOG_FILE for progress."
    else
        # Run in foreground (for testing or when called with --internal-run)
        if [[ "$action" == "restart" ]]; then
            do_restart
        elif [[ "$action" == "rollback" ]]; then
            if [[ -z "$commit" ]]; then
                commit=$(git rev-parse HEAD~1 2>/dev/null || echo "")
            fi
            do_rollback_and_restart "$commit"
        fi
    fi
}

# Internal entry point for detached execution
if [[ "${1:-}" == "--internal-run" ]]; then
    shift
    run_detached "$@"
    exit 0
fi

main "$@"
