# shellcheck shell=bash
#═══════════════════════════════════════════════════════════════════════════════
# opencode.sh - Shared helpers for driving opencode agents
#
# Every SOREN agent is an opencode TUI running in a tmux window, pinned to its
# own embedded-server port (SOREN_OC_PORT). This lib provides:
#   - model tier mapping        (soren_oc_model)
#   - free port allocation      (soren_oc_free_port)
#   - registry port lookup      (soren_oc_port_for)
#   - readiness / health        (soren_oc_health, soren_oc_wait_ready)
#   - HTTP message injection    (soren_oc_http_send)  [preferred over send-keys]
#   - TUI command execution     (soren_oc_http_command)
#
# Source this from tools/workers, tools/projects, and orchestrator scripts.
#═══════════════════════════════════════════════════════════════════════════════

# Map a model tier (haiku|sonnet|opus) to an opencode provider/model id.
# Full provider/model strings pass through unchanged. Overridable via env.
soren_oc_model() {
    case "${1:-}" in
        opus)   echo "${SOREN_MODEL_OPUS:-anthropic/claude-opus-4-6}" ;;
        sonnet) echo "${SOREN_MODEL_SONNET:-anthropic/claude-sonnet-4-5}" ;;
        haiku)  echo "${SOREN_MODEL_HAIKU:-anthropic/claude-haiku-4-5}" ;;
        "")     echo "" ;;
        *)      echo "$1" ;;
    esac
}

# Find a free TCP port for an agent's embedded opencode server.
# Range: 42000-42999 (SOREN worker port space).
soren_oc_free_port() {
    local port
    for _ in $(seq 1 50); do
        port=$(( 42000 + RANDOM % 1000 ))
        if ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            echo "$port"
            return 0
        fi
    done
    return 1
}

# Look up the opencode port for a named agent from the registry.
# Usage: soren_oc_port_for <agent-name> [registry-file]
soren_oc_port_for() {
    local name="$1"
    local reg="${2:-${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/agent_registry.json}"
    [[ -f "$reg" ]] || return 1
    local port
    port=$(jq -r --arg k "$name" '.[$k].oc_port // empty' "$reg" 2>/dev/null)
    [[ -n "$port" && "$port" != "null" ]] || return 1
    echo "$port"
}

# Health check for an agent's embedded server.
soren_oc_health() {
    local port="$1"
    curl -sf -m 2 "http://127.0.0.1:${port}/global/health" >/dev/null 2>&1
}

# Wait until the opencode instance on <port> is ready (or timeout).
# Usage: soren_oc_wait_ready <port> [timeout-seconds]
soren_oc_wait_ready() {
    local port="$1"
    local timeout="${2:-30}"
    local i
    for (( i = 0; i < timeout * 2; i++ )); do
        if soren_oc_health "$port"; then
            return 0
        fi
        sleep 0.5
    done
    return 1
}

# Inject a message into a running opencode TUI over HTTP.
# More reliable than tmux send-keys (no paste/prompt-state issues).
# Usage: soren_oc_http_send <port> <text>
soren_oc_http_send() {
    local port="$1"
    local text="$2"
    local payload
    payload=$(jq -cn --arg t "$text" '{text: $t}') || return 1
    curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/append-prompt" \
        -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1 || return 1
    sleep 0.2
    curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/submit-prompt" \
        -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || return 1
}

# Execute a TUI command (e.g. session.compact) on a running instance.
# Usage: soren_oc_http_command <port> <command>
soren_oc_http_command() {
    local port="$1"
    local command="$2"
    local payload
    payload=$(jq -cn --arg c "$command" '{command: $c}') || return 1
    curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/execute-command" \
        -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1
}

# Build the opencode CLI invocation for an agent spawn.
# Usage: soren_oc_cli <port> [model-tier-or-id] [session-id]
soren_oc_cli() {
    local port="$1"
    local model_tier="${2:-}"
    local session_id="${3:-}"
    local cmd="opencode --port ${port} --hostname 127.0.0.1"
    local model
    model=$(soren_oc_model "$model_tier")
    [[ -n "$model" ]] && cmd="${cmd} --model ${model}"
    [[ -n "$session_id" ]] && cmd="${cmd} --session ${session_id}"
    echo "$cmd"
}

# Permission grant for autonomous SOREN agents (replaces Claude Code's
# --dangerously-skip-permissions). Exported into every agent's environment.
SOREN_OC_PERMISSION='{"*":"allow","external_directory":{"*":"allow"}}'
export SOREN_OC_PERMISSION
