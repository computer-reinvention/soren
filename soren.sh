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
#   ./soren.sh server install   Install launchd agent: auto-start at login (always-on server)
#   ./soren.sh server uninstall Unload + remove the launchd agent
#   ./soren.sh server status    Server-mode status: launchd, health, tailscale serve
#   ./soren.sh help             Show this help
#
# Lifecycle commands delegate to src/orchestrator/soren.sh.
# Server mode (launchd + Tailscale remote access): docs/REMOTE_ACCESS.md
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
# Server mode (always-on home server: launchd boot + Tailscale remote access)
#───────────────────────────────────────────────────────────────────────────────

SERVER_LABEL="com.computerreinvention.soren"
SERVER_PLIST="${HOME}/Library/LaunchAgents/${SERVER_LABEL}.plist"
# The Tailscale.app bundled CLI. NEVER use /opt/homebrew/bin/tailscale here —
# the formula CLI talks to a different tailscaled socket than the app's
# NetworkExtension daemon (see docs/REMOTE_ACCESS.md, "two-CLI footgun").
TS_APP_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

write_server_plist() {
    local dest="$1"
    mkdir -p "$(dirname "$dest")"
    cat > "$dest" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVER_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${ROOT}/tools/server-boot</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>WorkingDirectory</key>
    <string>${ROOT}</string>
    <key>StandardOutPath</key>
    <string>${ROOT}/.soren/logs/server-boot.log</string>
    <key>StandardErrorPath</key>
    <string>${ROOT}/.soren/logs/server-boot.log</string>
</dict>
</plist>
EOF
}

server_plist_loaded() {
    launchctl print "gui/$(id -u)/${SERVER_LABEL}" >/dev/null 2>&1
}

tailscale_serve_configured() {
    "$TS_APP_CLI" serve status 2>/dev/null | grep -q "127\.0\.0\.1:${SOREN_PORT}"
}

cmd_server() {
    local action="${1:-status}"
    case "$action" in
        install)
            mkdir -p "${ROOT}/.soren/logs"
            write_server_plist "$SERVER_PLIST"
            ok "plist written: ${SERVER_PLIST}"
            # Idempotent: unload any previous copy before loading the new one
            if server_plist_loaded; then
                info "agent already loaded — booting out old copy first"
                launchctl bootout "gui/$(id -u)/${SERVER_LABEL}" 2>/dev/null || true
            fi
            if launchctl bootstrap "gui/$(id -u)" "$SERVER_PLIST" 2>/dev/null; then
                ok "launchd agent loaded (bootstrap gui/$(id -u))"
            else
                warn "launchctl bootstrap failed — falling back to legacy load -w"
                launchctl load -w "$SERVER_PLIST" 2>/dev/null || die "could not load launchd agent (bootstrap and load -w both failed)"
                ok "launchd agent loaded (load -w)"
            fi
            info "soren now auto-starts at login (RunAtLoad). Boot log: .soren/logs/server-boot.log"
            info "Runbook: docs/REMOTE_ACCESS.md"
            ;;
        uninstall)
            if server_plist_loaded; then
                launchctl bootout "gui/$(id -u)/${SERVER_LABEL}" 2>/dev/null \
                    || launchctl unload -w "$SERVER_PLIST" 2>/dev/null \
                    || warn "could not unload agent (already gone?)"
                ok "launchd agent unloaded"
            else
                info "launchd agent not loaded"
            fi
            if [[ -f "$SERVER_PLIST" ]]; then
                rm -f "$SERVER_PLIST"
                ok "removed ${SERVER_PLIST}"
            else
                info "no plist at ${SERVER_PLIST}"
            fi
            ;;
        status)
            # launchd
            if [[ ! -f "$SERVER_PLIST" ]]; then
                warn "launchd: not installed (run ./soren.sh server install)"
            elif server_plist_loaded; then
                ok "launchd: agent loaded (${SERVER_LABEL})"
            else
                warn "launchd: plist exists but agent not loaded — re-run ./soren.sh server install"
            fi
            # soren health
            if server_healthy; then
                ok "soren: healthy on 127.0.0.1:${SOREN_PORT}"
            else
                warn "soren: not responding on port ${SOREN_PORT}"
            fi
            # tailscale daemon (app CLI only)
            if [[ ! -x "$TS_APP_CLI" ]]; then
                warn "tailscale: Tailscale.app CLI not found (${TS_APP_CLI})"
            elif "$TS_APP_CLI" status >/dev/null 2>&1; then
                ok "tailscale: daemon running, logged in (app CLI)"
                if tailscale_serve_configured; then
                    ok "tailscale serve: tailnet HTTPS -> 127.0.0.1:${SOREN_PORT}"
                else
                    warn "tailscale serve: not configured for port ${SOREN_PORT} — run: \"${TS_APP_CLI}\" serve --bg ${SOREN_PORT}"
                fi
            else
                warn "tailscale: daemon not responding (app not running or logged out) — open -a Tailscale"
            fi
            ;;
        plist)
            # Write the plist to an arbitrary path without loading it
            # (used for linting/inspection; not part of normal workflows).
            local dest="${2:-$SERVER_PLIST}"
            write_server_plist "$dest"
            ok "plist written (not loaded): ${dest}"
            ;;
        *)
            die "usage: soren.sh server [install | uninstall | status]"
            ;;
    esac
}

# Non-fatal server-mode checks for cmd_doctor. Runs only when the launchd
# plist exists (server mode installed) or doctor is called with --server.
doctor_server_mode() {
    echo -e "${BOLD}Server mode${NC}"

    # launchd agent
    if server_plist_loaded; then
        ok "launchd agent loaded (${SERVER_LABEL})"
    elif [[ -f "$SERVER_PLIST" ]]; then
        warn "launchd plist exists but not loaded — re-run ./soren.sh server install"
    else
        warn "launchd agent not installed — run ./soren.sh server install"
    fi

    # tailscale daemon + login (app CLI ONLY — the homebrew CLI talks to a
    # different daemon socket and gives misleading answers here)
    if [[ ! -x "$TS_APP_CLI" ]]; then
        warn "Tailscale.app CLI not found at ${TS_APP_CLI} — install Tailscale.app"
    elif "$TS_APP_CLI" status >/dev/null 2>&1; then
        ok "tailscale daemon reachable and logged in (app CLI)"
        if tailscale_serve_configured; then
            ok "tailscale serve proxies tailnet HTTPS -> 127.0.0.1:${SOREN_PORT}"
        else
            warn "tailscale serve not configured for ${SOREN_PORT} — run: \"${TS_APP_CLI}\" serve --bg ${SOREN_PORT}"
        fi
    else
        warn "tailscale daemon not responding or logged out — open -a Tailscale, then sign in"
    fi

    # Remote Login (sshd). systemsetup -getremotelogin needs sudo, so probe
    # the port instead.
    if nc -z -w 2 localhost 22 >/dev/null 2>&1; then
        ok "Remote Login (SSH) enabled — port 22 open"
        # Best-effort password-auth probe: 'sshd -T' usually needs root; on
        # any error or uncertainty, stay silent (only warn on confirmed yes).
        if sshd -T 2>/dev/null | grep -qi '^passwordauthentication yes'; then
            warn "sshd accepts password auth — harden: docs/REMOTE_ACCESS.md → 'Direct SSH' → sshd hardening"
        fi
    else
        warn "Remote Login off — fix: sudo systemsetup -setremotelogin on"
    fi

    # AC sleep must be 0 for an always-on server. Parse the AC Power section
    # of `pmset -g custom` (section headers start at column 0, values are
    # indented).
    local ac_sleep
    ac_sleep=$(pmset -g custom 2>/dev/null | awk '
        /^AC Power:/    { ac = 1; next }
        /^[A-Za-z].*:$/ { ac = 0 }
        ac && $1 == "sleep" { print $2; exit }
    ')
    if [[ "$ac_sleep" == "0" ]]; then
        ok "pmset: no sleep on AC power"
    elif [[ -z "$ac_sleep" ]]; then
        warn "pmset: could not read AC sleep setting — check: pmset -g custom"
    else
        warn "pmset: Mac sleeps on AC power (sleep=${ac_sleep}) — fix: sudo pmset -c sleep 0 displaysleep 10"
    fi
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

    # Consolidated database: existence, integrity, and pending-migration state
    echo -e "${BOLD}Database${NC}"
    local db="${ROOT}/.soren/soren.db"
    if [[ -f "$db" ]]; then
        ok "soren.db present ($(du -h "$db" 2>/dev/null | cut -f1 | tr -d ' '))"
        local qc
        qc=$(sqlite3 -cmd '.timeout 5000' "$db" "PRAGMA quick_check;" 2>&1 | head -1)
        if [[ "$qc" == "ok" ]]; then
            ok "integrity: PRAGMA quick_check ok"
        else
            warn "integrity: PRAGMA quick_check reported: ${qc:-no output}"
        fi
        # A -wal (and -shm) sibling is normal for a live or recently-run
        # system — sqlite folds it back into the db on checkpoint.
        [[ -f "${db}-wal" ]] && info "WAL sidecar present (soren.db-wal) — normal, not an error"
    else
        warn "soren.db missing — created on first start (./soren.sh start)"
    fi
    local legacy_dbs="" n
    for n in tasks conversations agent_registry auth memories; do
        [[ -f "${ROOT}/.soren/${n}.db" ]] && legacy_dbs="${legacy_dbs} ${n}.db"
    done
    if [[ -n "$legacy_dbs" ]]; then
        warn "legacy database(s) present:${legacy_dbs} — migration pending; stop the system and run ./tools/migrate-state"
    else
        ok "No legacy per-domain DBs at .soren/ top level (consolidation complete)"
    fi
    echo ""

    # Server mode (non-fatal): only when installed, or explicitly requested
    if [[ -f "$SERVER_PLIST" || "${1:-}" == "--server" ]]; then
        doctor_server_mode
        echo ""
    fi

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
    info "Events:     sqlite3 .soren/soren.db \"SELECT event_type, agent_id FROM agent_events WHERE agent_id='${name}' ORDER BY timestamp DESC LIMIT 5\""
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
    sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

#───────────────────────────────────────────────────────────────────────────────
# Main
#───────────────────────────────────────────────────────────────────────────────

case "${1:-help}" in
    setup)   cmd_setup ;;
    doctor)  shift; cmd_doctor "$@" ;;
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
    server)  shift; cmd_server "$@" ;;
    help|--help|-h) cmd_help ;;
    *)       die "unknown command: $1 (see ./soren.sh help)" ;;
esac
