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
#   - prompt receipt verification (soren_oc_verify_prompt)
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

# Directory holding per-port reservation dirs (atomic mkdir = reservation).
_soren_oc_ports_dir() {
    echo "${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/run/ports"
}

# Is something listening on <port>? Uses, in order of availability:
# lsof (macOS/BSD), ss (Linux), bash /dev/tcp probe (last resort).
# Returns 0 if the port is TAKEN.
_soren_oc_port_in_use() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi
    if command -v ss >/dev/null 2>&1; then
        [[ -n "$(ss -Htln "sport = :${port}" 2>/dev/null)" ]]
        return $?
    fi
    # /dev/tcp probe: successful connect means the port is taken
    ( echo >/dev/tcp/127.0.0.1/"$port" ) 2>/dev/null && return 0
    return 1
}

# Find a free TCP port for an agent's embedded opencode server.
# Range: 42000-42999 (SOREN worker port space).
# Excludes ports already assigned in the agent registry, checks the port is
# actually free, then atomically reserves it via mkdir to close the TOCTOU
# window between concurrent spawns. Release with soren_oc_release_port.
soren_oc_free_port() {
    local reg="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/agent_registry.json"
    local assigned=""
    if [[ -f "$reg" ]]; then
        assigned=$(jq -r '[.[].oc_port] | map(select(. != null)) | .[]' "$reg" 2>/dev/null) || assigned=""
    fi

    local ports_dir
    ports_dir=$(_soren_oc_ports_dir)
    mkdir -p "$ports_dir" 2>/dev/null || true

    local port now mtime
    for _ in $(seq 1 50); do
        port=$(( 42000 + RANDOM % 1000 ))

        # Skip ports already assigned to agents in the registry
        if [[ -n "$assigned" ]] && printf '%s\n' "$assigned" | grep -qx "$port"; then
            continue
        fi

        # Skip ports with an active listener
        if _soren_oc_port_in_use "$port"; then
            continue
        fi

        # Opportunistic stale-reservation cleanup: dir exists but nothing
        # listens (checked above) and mtime is older than 120s -> reclaim.
        if [[ -d "$ports_dir/$port" ]]; then
            now=$(date +%s)
            mtime=$(stat -f %m "$ports_dir/$port" 2>/dev/null || stat -c %Y "$ports_dir/$port" 2>/dev/null || echo "$now")
            if (( now - mtime > 120 )); then
                rmdir "$ports_dir/$port" 2>/dev/null || true
            fi
        fi

        # Atomic reservation: mkdir fails if another spawn holds the port
        if mkdir "$ports_dir/$port" 2>/dev/null; then
            echo "$port"
            return 0
        fi
    done
    return 1
}

# Release a port reservation taken by soren_oc_free_port.
# Usage: soren_oc_release_port <port>
soren_oc_release_port() {
    local port="${1:-}"
    [[ -n "$port" ]] || return 0
    rmdir "$(_soren_oc_ports_dir)/$port" 2>/dev/null || true
    return 0
}

# Locked read-modify-write of the agent registry JSON.
# Usage: soren_registry_update <registry-file> [jq-args...] '<jq filter>'
# Uses flock when available (Linux); falls back to unlocked behavior on
# systems without flock (macOS dev machines).
soren_registry_update() {
    local reg="$1"
    shift
    local run_dir="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/run"
    mkdir -p "$run_dir" 2>/dev/null || true
    local lockfile="$run_dir/registry.lock"
    local tmp
    if command -v flock >/dev/null 2>&1; then
        (
            flock 200
            tmp=$(mktemp)
            jq "$@" "$reg" > "$tmp" && mv "$tmp" "$reg"
        ) 200>"$lockfile"
    else
        tmp=$(mktemp)
        jq "$@" "$reg" > "$tmp" && mv "$tmp" "$reg"
    fi
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

# Wait until the TUI's prompt-acceptance machinery is actually ready.
# /global/health can return 200 while the TUI session is still initializing.
# This probes append-prompt + clear-prompt to confirm the TUI input pipeline
# is wired up. Call AFTER soren_oc_wait_ready.
# Usage: soren_oc_wait_tui_ready <port> [timeout-seconds]
soren_oc_wait_tui_ready() {
    local port="$1"
    local timeout="${2:-15}"
    local payload='{"text":"."}'
    local i
    for (( i = 0; i < timeout * 2; i++ )); do
        # Try to append a single dot — if the TUI prompt is ready, this
        # succeeds with HTTP 200 AND the submit endpoint is wired up.
        if curl -sf -m 3 -X POST "http://127.0.0.1:${port}/tui/append-prompt" \
                -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1; then
            # Clean up: clear the dot we just appended
            curl -sf -m 3 -X POST "http://127.0.0.1:${port}/tui/clear-prompt" \
                -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || true
            return 0
        fi
        sleep 0.5
    done
    return 1
}

# Inject a message into a running opencode TUI over HTTP.
# More reliable than tmux send-keys (no paste/prompt-state issues).
# Retries up to $retries times (default 3) on submit failure to handle the
# race where /global/health is up but the TUI session hasn't finished init.
# Usage: soren_oc_http_send <port> <text> [retries]
soren_oc_http_send() {
    local port="$1"
    local text="$2"
    local retries="${3:-3}"
    local payload
    payload=$(jq -cn --arg t "$text" '{text: $t}') || return 1

    local attempt
    for (( attempt = 0; attempt <= retries; attempt++ )); do
        # Back off before retries (not on the first attempt)
        if (( attempt > 0 )); then
            sleep $(( attempt ))  # 1s, 2s, 3s
        fi

        # Append
        if ! curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/append-prompt" \
                -H 'Content-Type: application/json' -d "$payload" >/dev/null 2>&1; then
            continue  # TUI not ready yet, retry
        fi

        sleep 0.3

        # Submit
        if curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/submit-prompt" \
                -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1; then
            return 0  # Success
        fi

        # Submit failed — clear the appended text before retrying
        curl -sf -m 5 -X POST "http://127.0.0.1:${port}/tui/clear-prompt" \
            -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 || true
    done

    # All retries exhausted
    return 1
}

# Verify that a prompt was received by the opencode instance.
# Checks the embedded server's session API for a session CREATED after the
# given timestamp — meaning the TUI accepted our submit-prompt and started
# a new session to process it. This is a positive-confirmation signal that
# doesn't depend on tmux capture-pane (which is unreliable during TUI
# startup and can't distinguish "prompt queued" from "prompt lost").
#
# For spawn (cold TUI), submit-prompt triggers session creation; the new
# session's time.created will be after our pre-send timestamp. The session
# list is project-level (shared across agents), so we check time.created
# rather than time.updated to avoid false positives from other agents'
# ongoing sessions.
#
# Usage: soren_oc_verify_prompt <port> <after_epoch_ms> [timeout-seconds]
# Returns 0 if any session was created after the given timestamp.
soren_oc_verify_prompt() {
    local port="$1"
    local after_ms="$2"
    local timeout="${3:-15}"
    local i

    for (( i = 0; i < timeout; i++ )); do
        sleep 1
        # Check if any session was created after our pre-send timestamp.
        # For cold TUI spawn: submit-prompt creates a new session.
        local new_sessions
        new_sessions=$(curl -sf -m 3 "http://127.0.0.1:${port}/session" 2>/dev/null \
            | jq --argjson ts "$after_ms" \
                '[.[] | select(.time.created > $ts)] | length' 2>/dev/null) || continue
        if [[ "$new_sessions" =~ ^[0-9]+$ ]] && (( new_sessions > 0 )); then
            return 0
        fi
    done
    return 1
}

# Get the current epoch time in milliseconds.
# Usage: soren_epoch_ms
soren_epoch_ms() {
    # macOS date doesn't support %N; use perl for sub-second precision
    if perl -e 'use Time::HiRes qw(time); printf "%d\n", time()*1000' 2>/dev/null; then
        return
    fi
    # Fallback: seconds * 1000
    echo $(( $(date +%s) * 1000 ))
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
