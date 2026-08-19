#!/usr/bin/env bash
#═══════════════════════════════════════════════════════════════════════════════
# soren.sh - Single entrypoint for SOREN
#
# Usage:
#   ./soren.sh setup            First-time setup: check deps, install, build
#   ./soren.sh doctor           Diagnose prerequisites, auth, and system health
#   ./soren.sh start            Start the system (runs quick checks first)
#   ./soren.sh stop             Stop everything
#   ./soren.sh restart          Restart the system
#   ./soren.sh status           System status
#   ./soren.sh logs [type]      Tail logs (server|status|router|monitor)
#   ./soren.sh attach           Attach to the tmux session
#   ./soren.sh dash             Open the dashboard in a browser
#   ./soren.sh health           Hit the health endpoint
#   ./soren.sh test             Run the test suite (pytest + frontend typecheck)
#   ./soren.sh smoke            End-to-end smoke test: spawn a test worker
#   ./soren.sh team up [core]   Bootstrap the permanent worker team (core = 3)
#   ./soren.sh team status      Show permanent worker roster
#   ./soren.sh help             Show this help
#
# Lifecycle commands delegate to src/orchestrator/soren.sh.
#═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCH="${ROOT}/src/orchestrator/soren.sh"
SOREN_SESSION="${SOREN_SESSION:-soren}"
SOREN_PORT="${SOREN_PORT:-8000}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'
BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

die()  { echo -e "${RED}error:${NC} $1" >&2; exit 1; }
info() { echo -e "${CYAN}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

#───────────────────────────────────────────────────────────────────────────────
# Checks
#───────────────────────────────────────────────────────────────────────────────

REQUIRED_CMDS=(tmux git curl jq sqlite3 uv node npm bun opencode)

check_prereqs() {
    local missing=()
    local cmd
    for cmd in "${REQUIRED_CMDS[@]}"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            [[ "${1:-}" == "--verbose" ]] && ok "$cmd $(command -v "$cmd")"
        else
            missing+=("$cmd")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo ""
        warn "Missing required commands: ${missing[*]}"
        echo ""
        echo "Install hints:"
        for cmd in "${missing[@]}"; do
            case "$cmd" in
                opencode) echo "  opencode: curl -fsSL https://opencode.ai/install | bash" ;;
                uv)       echo "  uv:       curl -LsSf https://astral.sh/uv/install.sh | sh" ;;
                bun)      echo "  bun:      curl -fsSL https://bun.sh/install | bash" ;;
                node|npm) echo "  node/npm: https://nodejs.org or your package manager" ;;
                *)        echo "  $cmd: install via your package manager (brew/apt)" ;;
            esac
        done
        return 1
    fi
    return 0
}

check_auth() {
    # Agents need model credentials: opencode auth or a provider API key.
    if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
        ok "Model credentials: ANTHROPIC_API_KEY set"
        return 0
    fi
    local auth_file="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/auth.json"
    if [[ -s "$auth_file" ]]; then
        ok "Model credentials: opencode auth configured"
        return 0
    fi
    warn "No model credentials found."
    echo "  Run: opencode auth login    (or export ANTHROPIC_API_KEY)"
    return 1
}

check_python_deps() {
    if [[ -d "${ROOT}/.venv" ]]; then
        ok "Python deps installed (.venv)"
        return 0
    fi
    warn "Python deps not installed — run: ./soren.sh setup"
    return 1
}

check_frontend() {
    if [[ -d "${ROOT}/src/frontend/dist" ]]; then
        ok "Frontend built (src/frontend/dist)"
        return 0
    fi
    warn "Frontend not built — run: ./soren.sh setup"
    return 1
}

server_healthy() {
    curl -sf -m 3 "http://localhost:${SOREN_PORT}/api/webhooks/health" >/dev/null 2>&1
}

#───────────────────────────────────────────────────────────────────────────────
# Commands
#───────────────────────────────────────────────────────────────────────────────

cmd_setup() {
    echo -e "${BOLD}SOREN setup${NC}"
    echo ""

    info "Checking prerequisites..."
    check_prereqs --verbose || die "install the missing commands above, then re-run ./soren.sh setup"
    echo ""

    info "Installing Python dependencies (uv sync --extra dev)..."
    (cd "$ROOT" && uv sync --extra dev)
    ok "Python deps installed"
    echo ""

    info "Installing + building frontend..."
    (cd "${ROOT}/src/frontend" && npm install --no-fund --no-audit && npm run build)
    ok "Frontend built"
    echo ""

    info "Checking model credentials..."
    check_auth || true
    echo ""

    ok "Setup complete. Start with: ./soren.sh start"
}

cmd_doctor() {
    echo -e "${BOLD}SOREN doctor${NC}"
    echo ""

    echo -e "${BOLD}Prerequisites${NC}"
    check_prereqs --verbose || true
    echo ""

    echo -e "${BOLD}Installation${NC}"
    check_python_deps || true
    check_frontend || true
    echo ""

    echo -e "${BOLD}Credentials${NC}"
    check_auth || true
    echo ""

    echo -e "${BOLD}Runtime${NC}"
    if tmux has-session -t "$SOREN_SESSION" 2>/dev/null; then
        ok "tmux session '${SOREN_SESSION}' running ($(tmux list-windows -t "$SOREN_SESSION" 2>/dev/null | wc -l | tr -d ' ') windows)"
    else
        warn "tmux session '${SOREN_SESSION}' not running"
    fi
    if server_healthy; then
        ok "Server healthy on port ${SOREN_PORT}"
    else
        warn "Server not responding on port ${SOREN_PORT}"
    fi

    # Port drift: registered oc_ports that don't answer while their window lives
    local reg="${ROOT}/.soren/agent_registry.json"
    if [[ -f "$reg" ]] && command -v jq >/dev/null 2>&1; then
        local drift=0 name port
        while IFS=$'\t' read -r name port; do
            [[ -z "$port" || "$port" == "null" ]] && continue
            tmux list-windows -t "$SOREN_SESSION" -F '#{window_name}' 2>/dev/null | grep -qxF "$name" || continue
            if ! curl -sf -m 2 "http://127.0.0.1:${port}/global/health" >/dev/null 2>&1; then
                warn "oc_port drift: ${name} registered on :${port} but not answering (self-heals on next send)"
                drift=$((drift+1))
            fi
        done < <(jq -r 'to_entries[] | [.key, (.value.oc_port // "")] | @tsv' "$reg" 2>/dev/null)
        [[ $drift -eq 0 ]] && ok "Agent ports consistent with registry"
    fi
    echo ""

    # Deep verification (plugin, hooks, tools) if the system-verify tool exists
    if [[ -x "${ROOT}/tools/system-verify" ]]; then
        echo -e "${BOLD}System verification${NC}"
        "${ROOT}/tools/system-verify" || true
    fi
}

cmd_start() {
    check_prereqs || die "missing prerequisites — run ./soren.sh setup"
    check_python_deps >/dev/null || cmd_setup
    if ! check_frontend >/dev/null; then
        info "Frontend not built — building now..."
        (cd "${ROOT}/src/frontend" && npm install --no-fund --no-audit && npm run build)
    fi
    check_auth || die "configure credentials first (opencode auth login)"
    exec "$ORCH" start
}

cmd_smoke() {
    server_healthy || die "server not healthy — start the system first: ./soren.sh start"
    local name="smoke-$(date +%H%M%S)"
    info "Spawning smoke-test worker '${name}'..."
    "${ROOT}/tools/workers" spawn "$name" \
        "Smoke test (research task, no commit needed): read AGENTS.md, then run ./tools/mailbox done 'smoke test OK — <one line about what SOREN is>'. Then stop."
    echo ""
    info "Watch it:   tmux attach -t ${SOREN_SESSION}   (window: ${name})"
    info "Events:     sqlite3 .soren/conversations.db \"SELECT event_type, agent_id FROM agent_events WHERE agent_id='${name}' ORDER BY timestamp DESC LIMIT 5\""
    info "Clean up:   ./tools/workers kill ${name}"
}

cmd_test() {
    info "Running Python tests..."
    (cd "$ROOT" && uv run pytest tests -q) || die "pytest failed"
    if [[ -d "${ROOT}/src/frontend/node_modules" ]]; then
        info "Running frontend typecheck..."
        (cd "${ROOT}/src/frontend" && npm run typecheck) || die "typecheck failed"
    else
        warn "Frontend node_modules missing — skipping typecheck (run ./soren.sh setup)"
    fi
    ok "All tests passed"
}

# Bootstrap the permanent worker team from versioned role templates.
# core = builders + QA only (3 agents); full = the whole TEAM.md roster (8).
# NOTE: permanent workers are keep_awake — they stay resident and respond to
# heartbeat nudges, which costs tokens. Start with core.
TEAM_CORE=(perm-backend perm-frontend perm-qa)
TEAM_FULL=(perm-backend perm-frontend perm-infra perm-ui-review perm-api-review perm-research perm-devops perm-qa)

cmd_team() {
    local action="${1:-status}"
    case "$action" in
        up)
            server_healthy || die "system not running — ./soren.sh start first"
            local size="${2:-core}"
            local roster=()
            case "$size" in
                core) roster=("${TEAM_CORE[@]}") ;;
                full) roster=("${TEAM_FULL[@]}") ;;
                *)    die "usage: soren.sh team up [core|full]" ;;
            esac
            info "Validating role contracts..."
            "${ROOT}/tools/contract" validate all || die "role contract validation failed — fix templates/team/*.md before spawning"
            info "Compiling role contracts..."
            "${ROOT}/tools/contract" compile || die "contract compile failed"
            local contracts="${ROOT}/.soren/run/contracts.json"
            [[ -f "$contracts" ]] || die "compiled contracts missing: $contracts"
            warn "Spawning ${#roster[@]} permanent workers (contract-driven tier/worktree, keep_awake — they stay resident)."
            mkdir -p "${ROOT}/.soren/worker-contexts"
            local id role_src role_dst spawned=0 tier wt_req spawn_desc knowledge_src
            for id in "${roster[@]}"; do
                role_src="${ROOT}/templates/team/${id}-role.md"
                role_dst="${ROOT}/.soren/worker-contexts/${id}-role.md"
                [[ -f "$role_src" ]] || { warn "missing template: $role_src — skipping $id"; continue; }
                if tmux list-windows -t "$SOREN_SESSION" -F '#{window_name}' 2>/dev/null | grep -qxF "$id"; then
                    ok "$id already running"
                    continue
                fi
                cp "$role_src" "$role_dst"
                # Inject durable working knowledge (if any) so spawned workers
                # get role + accumulated knowledge in a single read.
                knowledge_src="${ROOT}/templates/team/knowledge/${id}.md"
                if [[ -f "$knowledge_src" ]]; then
                    {
                        printf '\n---\n\n## Accumulated Working Knowledge (durable — survives resets)\n\n'
                        cat "$knowledge_src"
                    } >> "$role_dst"
                    info "  knowledge injected into ${id} role context"
                fi
                # Contract is the law: tier and worktree policy come from the
                # compiled contracts.json, not hardcoded policy. The tier name
                # is passed to `workers spawn --model` as-is; the tier→provider
                # model mapping (SOREN_MODEL_OPUS/SONNET/HAIKU overrides) is
                # applied downstream in tools/lib/opencode.sh (soren_oc_model).
                tier=$(jq -r --arg id "$id" '.[$id].tier // "opus"' "$contracts" 2>/dev/null) || tier="opus"
                case "$tier" in
                    haiku|sonnet|opus) ;;
                    *) warn "$id: unknown tier '$tier' in contract — defaulting to opus"; tier="opus" ;;
                esac
                wt_req=$(jq -r --arg id "$id" '.[$id].worktree_required // false' "$contracts" 2>/dev/null) || wt_req="false"
                local spawn_args
                spawn_args=("$id" "permanent role bootstrap" --permanent "$role_dst" --model "$tier")
                spawn_desc="tier=$tier"
                if [[ "$wt_req" == "true" ]]; then
                    spawn_args=("${spawn_args[@]}" --worktree)
                    spawn_desc="$spawn_desc worktree=yes"
                fi
                info "Spawning $id ($spawn_desc)..."
                "${ROOT}/tools/workers" spawn "${spawn_args[@]}" || { warn "spawn failed for $id"; continue; }
                spawned=$((spawned+1))
            done
            ok "Team up: ${spawned} spawned. Check: ./soren.sh team status"
            ;;
        status)
            "${ROOT}/tools/workers" team
            ;;
        *)
            die "usage: soren.sh team [up [core|full] | status]"
            ;;
    esac
}

cmd_help() {
    sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

#───────────────────────────────────────────────────────────────────────────────
# Main
#───────────────────────────────────────────────────────────────────────────────

case "${1:-help}" in
    setup)   cmd_setup ;;
    doctor)  cmd_doctor ;;
    start)   cmd_start ;;
    stop|restart|status|detached-restart)
             exec "$ORCH" "$@" ;;
    logs)    shift; exec "$ORCH" logs "${1:-server}" ;;
    attach)  exec tmux attach -t "$SOREN_SESSION" ;;
    dash)    if command -v open >/dev/null 2>&1; then open "http://localhost:${SOREN_PORT}"
             elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:${SOREN_PORT}"
             else echo "Dashboard: http://localhost:${SOREN_PORT}"; fi ;;
    health)  curl -sf "http://localhost:${SOREN_PORT}/api/webhooks/health" | jq . || \
             die "server not responding on port ${SOREN_PORT}" ;;
    test)    cmd_test ;;
    smoke)   cmd_smoke ;;
    team)    shift; cmd_team "$@" ;;
    help|--help|-h) cmd_help ;;
    *)       die "unknown command: $1 (see ./soren.sh help)" ;;
esac
