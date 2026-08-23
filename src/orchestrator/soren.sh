#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# SOREN - Self-Improving Multi-Agent Orchestrator
#
# Creates a tmux session where Window 0 is the control center.
# All setup and agent launching happens visibly from Window 0.
#
# Session Structure:
#   Window 0: Monitor (control center - you are here)
#   Window 1: Supervisor Agent
#   Window 2+: Worker Agents (created as needed)
#═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/logging.sh"

# Spoof-proofing: the human-gate flag is process-internal state set only by
# require_human() after verification. It must never arrive via the environment.
unset _SOREN_HUMAN_OK

# Configuration
SOREN_SESSION="${SOREN_SESSION:-soren}"
SOREN_PORT="${SOREN_PORT:-8000}"
SOREN_HOST="${SOREN_HOST:-127.0.0.1}"
SOREN_PROJECT_ROOT="${SOREN_PROJECT_ROOT:-$(pwd)}"

# Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

#───────────────────────────────────────────────────────────────────────────────
# Human gate — full-stack 'stop' and 'restart' are sudo-guarded
#
# These commands kill the tmux session: every agent, the monitor, and (when
# invoked from inside the session) the invoker itself, mid-command. Agents did
# exactly this twice on 2026-08-23 — the supervisor self-decapitated running
# 'restart', then the worker sent to fix it nuked the system again testing its
# own env-var override. Env overrides are spoofable; sudo is not.
#
# Rule: stop/restart require proof-of-human via sudo. Agents have no sudo
# password. The sanctioned agent path is:  soren.sh detached-restart --restart
#
# Accepted proofs (checked in order):
#   1. _SOREN_HUMAN_OK=1        process-internal only (restart -> stop chain);
#                               force-unset at startup, cannot come from env
#   2. EUID 0 via sudo          'sudo ./soren.sh stop' — plants a root-owned
#                               single-use token and re-execs as $SUDO_USER,
#                               because the work must NOT run as root (tmux
#                               sockets are per-user; root would miss the
#                               user's tmux server entirely)
#   3. fresh root-owned token   minted by (2) within the last 60s; agents
#                               cannot forge root-owned files
#   4. interactive 'sudo -v'    inline password prompt on this TTY
#───────────────────────────────────────────────────────────────────────────────

_HUMAN_GATE_TOKEN="${SOREN_PROJECT_ROOT:-$(pwd)}/.soren/.human-gate-token"

require_human() {
    local action="$1"

    # (1) Already verified within this process (restart -> internal stop).
    [[ "${_SOREN_HUMAN_OK:-}" == "1" ]] && return 0

    # (2) Invoked as root ('sudo ./soren.sh stop'): mint token, drop to user.
    if [[ $EUID -eq 0 ]]; then
        if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
            if [[ ! -d "${SOREN_PROJECT_ROOT}/.soren" ]]; then
                printf "${RED}No .soren directory at ${SOREN_PROJECT_ROOT} — nothing to ${action}${NC}\n" >&2
                exit 1
            fi
            date +%s > "$_HUMAN_GATE_TOKEN"
            chmod 644 "$_HUMAN_GATE_TOKEN"
            exec sudo -u "$SUDO_USER" env PATH="$PATH" \
                SOREN_SESSION="$SOREN_SESSION" SOREN_PORT="$SOREN_PORT" \
                SOREN_HOST="$SOREN_HOST" SOREN_PROJECT_ROOT="$SOREN_PROJECT_ROOT" \
                "${SCRIPT_DIR}/soren.sh" "$action"
        fi
        _SOREN_HUMAN_OK=1   # genuine root shell (no SUDO_USER): proceed as-is
        return 0
    fi

    # (3) Fresh root-owned single-use token from path (2).
    if [[ -f "$_HUMAN_GATE_TOKEN" ]]; then
        local owner mtime age
        owner=$(stat -f %u "$_HUMAN_GATE_TOKEN" 2>/dev/null || echo -1)
        mtime=$(stat -f %m "$_HUMAN_GATE_TOKEN" 2>/dev/null || echo 0)
        age=$(( $(date +%s) - mtime ))
        rm -f "$_HUMAN_GATE_TOKEN" 2>/dev/null || true   # single-use, always consumed
        if [[ "$owner" == "0" && $age -ge 0 && $age -le 60 ]]; then
            _SOREN_HUMAN_OK=1
            return 0
        fi
    fi

    # Agents are refused outright — clearly, and without a prompt to hang on.
    if [[ "${SOREN_AGENT:-}" == "true" ]]; then
        printf "${RED}[SOREN] '${action}' is human-only (sudo-gated).${NC}\n" >&2
        printf "  Full-stack ${action} kills the tmux session: every agent, the monitor,\n" >&2
        printf "  and YOU — mid-command. This exact mistake caused both outages on 2026-08-23.\n" >&2
        printf "  There is no env-var override. Do not test this against the live system.\n" >&2
        printf "  Server-only restart (safe): ${CYAN}./soren.sh detached-restart --restart --detach${NC}\n" >&2
        printf "  Humans run:                 ${CYAN}sudo ./soren.sh ${action}${NC}\n" >&2
        log_status "GUARD" "Blocked '${action}' from agent ${SOREN_AGENT_NAME:-unknown} (sudo human gate)"
        exit 87
    fi

    # (4) Interactive human: authenticate here, then continue as this user.
    printf "${YELLOW}[SOREN] '${action}' stops the whole system (server + tmux session + all agents).${NC}\n"
    printf "${YELLOW}        sudo authentication required — agents cannot pass this gate.${NC}\n"
    if sudo -p "[soren human gate] sudo password for %p: " -v; then
        _SOREN_HUMAN_OK=1
        return 0
    fi
    log_status "GUARD" "Blocked '${action}': sudo authentication failed (uid $(id -u))"
    printf "${RED}sudo authentication required for '${action}' — refused.${NC}\n" >&2
    printf "Agents: use ${CYAN}./soren.sh detached-restart --restart --detach${NC} instead.\n" >&2
    exit 87
}

#───────────────────────────────────────────────────────────────────────────────
# Commands
#───────────────────────────────────────────────────────────────────────────────

cmd_start() {
    # Check dependencies first
    for cmd in tmux opencode git curl uv; do
        if ! command -v $cmd &>/dev/null; then
            printf "${RED}Error: $cmd is required but not installed${NC}\n"
            log_status "STARTUP" "FATAL: Missing dependency: $cmd"
            exit 1
        fi
    done
    log_status "STARTUP" "soren.sh start invoked (session: ${SOREN_SESSION}, port: ${SOREN_PORT})"

    # If we're inside the soren session's monitor window, run orchestration directly
    if [[ -n "${TMUX:-}" ]]; then
        local current_session
        current_session=$(tmux display-message -p '#S')
        if [[ "$current_session" == "$SOREN_SESSION" ]]; then
            exec "${SCRIPT_DIR}/monitor.sh"
        fi
    fi

    # If session already exists, just report it
    if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
        printf "${GREEN}Session '$SOREN_SESSION' already running${NC}\n"
        printf "Run '${CYAN}soren.sh attach${NC}' to attach\n"
        printf "Run '${CYAN}soren.sh status${NC}' to check status\n"
        exit 0
    fi

    printf "${CYAN}"
    cat << "EOF"
    ╔═══════════════════════════════════════════════════════════════════╗
    ║                    SOREN ORCHESTRATOR                              ║
    ╚═══════════════════════════════════════════════════════════════════╝
EOF
    printf "${NC}\n"

    echo "Project: $(basename "$SOREN_PROJECT_ROOT")"
    echo "Path:    $SOREN_PROJECT_ROOT"
    echo ""

    # Create tmux session with window 0 as the monitor/control center
    printf "${BOLD}Creating tmux session...${NC}\n"

    if tmux new-session -d -s "$SOREN_SESSION" -n "monitor" \
        "cd '$SOREN_PROJECT_ROOT' && '$SCRIPT_DIR/monitor.sh'"; then
        log_status "STARTUP" "tmux session '${SOREN_SESSION}' created successfully"
    else
        log_status "STARTUP" "FAILED: Could not create tmux session '${SOREN_SESSION}'"
        printf "${RED}Failed to create tmux session${NC}\n"
        exit 1
    fi

    # Lock window name to prevent renaming
    tmux set-option -t "$SOREN_SESSION:monitor" allow-rename off

    # Aggressive resize: size windows to the smallest session actually viewing
    # them (not the smallest attached client), so web-terminal viewport
    # sessions (view-*, grouped onto this session) don't letterbox agents.
    # -g sets the global window option, which grouped sessions inherit.
    tmux set-option -t "$SOREN_SESSION" -g aggressive-resize on 2>/dev/null || true

    printf "${GREEN}✓${NC} Session started: ${SOREN_SESSION}\n"
    printf "${GREEN}✓${NC} Monitor window launched\n"
    echo ""
    printf "Run '${CYAN}soren.sh attach${NC}' to attach to the session\n"
    printf "Run '${CYAN}soren.sh status${NC}' to check status\n"
}

cmd_stop() {
    require_human "stop"
    log_info "Stopping soren system..."
    log_status "SHUTDOWN" "soren.sh stop invoked (human-verified)"

    local STOP_TIMEOUT=15

    # Start timeout watchdog
    (
        sleep "$STOP_TIMEOUT"
        log_error "Stop timed out after ${STOP_TIMEOUT}s - forcing kill"
        pkill -9 -f "uvicorn.*src.server.main:app" 2>/dev/null || true
        local force_pids
        force_pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)
        [[ -n "$force_pids" ]] && echo "$force_pids" | xargs kill -9 2>/dev/null || true
    ) &
    local timeout_pid=$!

    # Get all PIDs holding the port
    local pids
    pids=$(lsof -ti tcp:"$SOREN_PORT" 2>/dev/null || true)

    if [[ -n "$pids" ]]; then
        # SIGTERM first (graceful shutdown) - log each kill
        for pid in $pids; do
            kill "$pid" 2>/dev/null && log_info "Sent SIGTERM to PID $pid"
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
                kill -9 "$pid" 2>/dev/null && log_info "Force killed PID $pid"
            done
        fi
    fi

    # Fallback: kill by process name (catches orphan workers)
    pkill -f "uvicorn.*src.server.main:app" 2>/dev/null || true

    # Cancel timeout watchdog
    kill "$timeout_pid" 2>/dev/null || true
    wait "$timeout_pid" 2>/dev/null || true

    # Verify port is free
    sleep 1
    if lsof -ti tcp:"$SOREN_PORT" >/dev/null 2>&1; then
        printf "${YELLOW}!${NC} Port $SOREN_PORT still in use (may need: kill -9 \$(lsof -ti tcp:$SOREN_PORT))\n"
    else
        printf "${GREEN}✓${NC} FastAPI server stopped\n"
    fi

    # Kill tmux sessions (unchanged from original)
    if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
        tmux kill-session -t "$SOREN_SESSION"
        printf "${GREEN}✓${NC} tmux session killed\n"
    fi

    for sess in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^soren-" || true); do
        tmux kill-session -t "$sess" 2>/dev/null || true
        printf "${GREEN}✓${NC} Killed spawned session: $sess\n"
    done

    log_status "SHUTDOWN" "soren system stopped"
    printf "${GREEN}soren system stopped${NC}\n"
}

cmd_restart() {
    require_human "restart"
    cmd_stop
    sleep 2
    cmd_start
}

cmd_status() {
    printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
    printf "${BOLD}                    SOREN Status${NC}\n"
    printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
    echo ""

    # tmux session
    if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
        printf "tmux session: ${GREEN}$SOREN_SESSION (running)${NC}\n"
        echo ""
        printf "${BOLD}Windows:${NC}\n"
        tmux list-windows -t "$SOREN_SESSION" -F "  #{window_index}: #{window_name}" 2>/dev/null
    else
        printf "tmux session: ${RED}$SOREN_SESSION (not running)${NC}\n"
        echo ""
        echo "Run 'soren.sh start' to start the system."
        return
    fi
    echo ""

    # FastAPI server
    if curl -sf "http://localhost:${SOREN_PORT}/api/webhooks/health" >/dev/null 2>&1; then
        printf "FastAPI server: ${GREEN}running (port ${SOREN_PORT})${NC}\n"
    else
        printf "FastAPI server: ${RED}stopped${NC}\n"
    fi
    echo ""

    printf "${CYAN}═══════════════════════════════════════════════════════════════${NC}\n"
}

cmd_attach() {
    if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
        exec tmux attach -t "$SOREN_SESSION"
    else
        printf "${RED}Error: No tmux session found: $SOREN_SESSION${NC}\n"
        echo "Run 'soren.sh start' to start the system first."
        exit 1
    fi
}

cmd_logs() {
    local log_type="${1:-server}"
    case "$log_type" in
        server)
            if [[ -f "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" ]]; then
                tail -f "${SOREN_PROJECT_ROOT}/.soren/logs/server.log"
            else
                echo "No server log found. Is the server running?"
                exit 1
            fi
            ;;
        orch|orchestrator)
            local orch_log="${SOREN_ORCH_LOG:-.soren/orchestrator.log}"
            if [[ -f "$orch_log" ]]; then
                tail -f "$orch_log"
            else
                echo "No orchestrator log found at $orch_log"
                exit 1
            fi
            ;;
        status)
            local status_log="${SOREN_STATUS_LOG:-.soren/status.log}"
            if [[ -f "$status_log" ]]; then
                tail -f "$status_log"
            else
                echo "No status log found at $status_log"
                exit 1
            fi
            ;;
        all)
            tail -f "${SOREN_PROJECT_ROOT}/.soren/logs/server.log" .soren/orchestrator.log .soren/status.log 2>/dev/null
            ;;
        *)
            echo "Unknown log type: $log_type"
            echo "Available: server, orch, status, all"
            exit 1
            ;;
    esac
}

cmd_detached_restart() {
    # Pass all arguments to detached-restart.sh
    exec "${SCRIPT_DIR}/detached-restart.sh" "$@"
}

cmd_init() {
    # Delegate to tools/soren-init
    exec "${SOREN_PROJECT_ROOT}/tools/soren-init" "$@"
}

cmd_run() {
    # Delegate to tools/soren-run
    exec "${SOREN_PROJECT_ROOT}/tools/soren-run" "$@"
}

cmd_help() {
    printf "${BOLD}Usage:${NC} soren.sh <command>\n"
    echo ""
    printf "${BOLD}Commands:${NC}\n"
    printf "  ${CYAN}start${NC}              Start the soren system (creates tmux session)\n"
    printf "  ${CYAN}stop${NC}               Stop the soren system (human-only: sudo-gated)\n"
    printf "  ${CYAN}restart${NC}            Restart the soren system (human-only: sudo-gated)\n"
    printf "  ${CYAN}status${NC}             Show system status\n"
    printf "  ${CYAN}attach${NC}             Attach to tmux session\n"
    printf "  ${CYAN}logs [type]${NC}        Tail logs (server|orch|status|all)\n"
    printf "  ${CYAN}init <path>${NC}        Onboard a new project (register + hooks + activate)\n"
    printf "  ${CYAN}run \"<task>\"${NC}       Decompose task and dispatch to workers\n"
    printf "  ${CYAN}detached-restart${NC}   Restart server in detached mode (safe for agents)\n"
    printf "  ${CYAN}help${NC}               Show this help\n"
    echo ""
    printf "${BOLD}Detached restart options:${NC}\n"
    printf "  --restart              Restart the FastAPI server only\n"
    printf "  --rollback [commit]    Rollback to commit and restart\n"
    printf "  --detach               Run in background (for agent use)\n"
    echo ""
    printf "${BOLD}tmux shortcuts:${NC}\n"
    printf "  Ctrl+b n/p    Switch between windows\n"
    printf "  Ctrl+b d      Detach from session\n"
    printf "  Ctrl+b [      Enter scroll mode\n"
}

#───────────────────────────────────────────────────────────────────────────────
# Main
#───────────────────────────────────────────────────────────────────────────────

main() {
    case "${1:-start}" in
        start)   cmd_start ;;
        stop)    cmd_stop ;;
        restart) cmd_restart ;;
        status)  cmd_status ;;
        attach)  cmd_attach ;;
        logs)    shift; cmd_logs "${1:-server}" ;;
        detached-restart) shift; cmd_detached_restart "$@" ;;
        init)    shift; cmd_init "$@" ;;
        run)     shift; cmd_run "$@" ;;
        help|-h|--help) cmd_help ;;
        *)
            printf "${RED}Unknown command: %s${NC}\n" "$1"
            echo ""
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
