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

#═══════════════════════════════════════════════════════════════════════════════
# Agent registry — SQLite master, JSON view
#
# The registry MASTER is the `agents` table in the consolidated SQLite DB
# (.soren/soren.db; same schema as src/server/services/agent_registry.py:
# key PK, agent_id, status, data JSON blob — agent_id/status are columns
# DERIVED from the data blob). agent_registry.json is a REGENERATED READ-ONLY
# VIEW of that table so existing jq readers keep working unchanged. Never
# write the JSON file directly — route every mutation through
# soren_registry_update().
#
# Concurrency model: sqlite BEGIN IMMEDIATE + busy_timeout is the real write
# serializer. The read→jq→write cycle is made atomic with an optimistic CAS:
# the write transaction only applies if the table still serializes to the
# snapshot we read; on conflict we retry with a fresh snapshot. flock (when
# available — NOT on stock macOS) is kept as a belt around the whole
# operation, but correctness does not depend on it. .soren/run/registry.lock
# is retained for that belt only.
#═══════════════════════════════════════════════════════════════════════════════

# Resolve the SQLite master for a given registry view file.
# SOREN_DB (explicit override, used by tests/sandboxes — same contract as
# tools/lib/db.sh) wins; otherwise the master lives next to the view:
# <dir-of-view>/soren.db.
_soren_registry_db_for() {
    if [[ -n "${SOREN_DB:-}" ]]; then
        echo "$SOREN_DB"
    else
        echo "$(dirname "$1")/soren.db"
    fi
}

# sqlite3 with the project-wide 5s busy timeout. Deliberately self-contained
# (no dependency on tools/lib/db.sh) so opencode.sh stays sourceable alone,
# e.g. from src/orchestrator/lib/tmux.sh.
_soren_registry_sql() {
    sqlite3 -cmd '.timeout 5000' "$@"
}

# Create the agents table/indexes if missing (schema identical to the python
# service's — IF NOT EXISTS makes this a no-op on an initialized DB).
_soren_registry_ensure_schema() {
    local db="$1"
    mkdir -p "$(dirname "$db")" 2>/dev/null || true
    _soren_registry_sql "$db" "
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS agents (
    key        TEXT PRIMARY KEY,
    agent_id   TEXT,
    status     TEXT,
    data       TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_id
    ON agents(agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_status
    ON agents(status);" >/dev/null
}

# Serialize the whole agents table as one JSON object (key → data blob).
_soren_registry_snapshot() {
    _soren_registry_sql "$1" \
        "SELECT COALESCE(json_group_object(key, json(data)), '{}') FROM agents;"
}

# Does this sqlite3 CLI ship the fileio extension (readfile)? Probed once per
# process. Verified present on this machine's Homebrew 3.53 AND stock
# /usr/bin/sqlite3 3.51; the python fallback below covers builds without it.
_soren_registry_has_readfile() {
    if [[ -z "${_SOREN_REG_READFILE:-}" ]]; then
        if sqlite3 ":memory:" "SELECT typeof(readfile('/dev/null'));" >/dev/null 2>&1; then
            _SOREN_REG_READFILE="yes"
        else
            _SOREN_REG_READFILE="no"
        fi
    fi
    [[ "$_SOREN_REG_READFILE" == "yes" ]]
}

# Compare-and-swap write: replace the agents table with the object in file
# <new> ONLY IF the table still serializes to the snapshot in file <snap>.
# Prints 1 (applied) or 0 (conflict — caller retries); nonzero rc on error.
# Derived columns are recomputed from the data blob: agent_id ← .agent_id,
# status ← .status (NULL when absent — same defaults the python service uses).
# CAST(readfile(...) AS TEXT) is required: readfile returns a BLOB, and blobs
# fed to json functions are interpreted as JSONB on sqlite ≥3.45.
_soren_registry_cas_write() {
    local db="$1" snap="$2" new="$3"
    if _soren_registry_has_readfile; then
        local snap_sql="${snap//\'/\'\'}" new_sql="${new//\'/\'\'}"
        _soren_registry_sql "$db" "
BEGIN IMMEDIATE;
CREATE TEMP TABLE _rmw AS
    SELECT ((SELECT COALESCE(json_group_object(key, json(data)), '{}') FROM agents)
            = CAST(readfile('${snap_sql}') AS TEXT)) AS ok;
DELETE FROM agents
    WHERE (SELECT ok FROM _rmw)
      AND key NOT IN (SELECT key FROM json_each(CAST(readfile('${new_sql}') AS TEXT)));
INSERT OR REPLACE INTO agents(key, agent_id, status, data)
    SELECT je.key,
           json_extract(je.value, '\$.agent_id'),
           json_extract(je.value, '\$.status'),
           json(je.value)
    FROM json_each(CAST(readfile('${new_sql}') AS TEXT)) AS je
    WHERE (SELECT ok FROM _rmw);
SELECT ok FROM _rmw;
COMMIT;"
    else
        # Fallback for sqlite3 CLIs without the fileio extension: same CAS
        # transaction via python's stdlib sqlite3.
        python3 - "$db" "$snap" "$new" <<'PYEOF'
import json, sqlite3, sys

db, snap_path, new_path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(snap_path) as f:
    snap = f.read()
with open(new_path) as f:
    new = json.load(f)

conn = sqlite3.connect(db, timeout=5, isolation_level=None)
try:
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute(
        "SELECT COALESCE(json_group_object(key, json(data)), '{}') FROM agents"
    ).fetchone()
    if (row[0] if row else "{}") != snap:
        conn.execute("ROLLBACK")
        print(0)
        sys.exit(0)
    keys = list(new.keys())
    if keys:
        conn.execute(
            "DELETE FROM agents WHERE key NOT IN (%s)" % ",".join("?" * len(keys)),
            keys,
        )
    else:
        conn.execute("DELETE FROM agents")
    for k, v in new.items():
        aid = v.get("agent_id") if isinstance(v, dict) else None
        status = v.get("status") if isinstance(v, dict) else None
        conn.execute(
            "INSERT OR REPLACE INTO agents(key, agent_id, status, data) VALUES (?,?,?,?)",
            (k, aid, status, json.dumps(v, ensure_ascii=False, separators=(",", ":"))),
        )
    conn.execute("COMMIT")
    print(1)
finally:
    conn.close()
PYEOF
    fi
}

# Regenerate the JSON view from the master (pretty, jq two-space format —
# byte-identical to the python service's export). tmp+rename in the SAME
# directory so the replacement is an atomic same-filesystem rename.
_soren_registry_regen_view() {
    local db="$1" reg="$2"
    local tmp
    tmp=$(mktemp "${reg}.tmp.XXXXXX") || return 1
    if _soren_registry_snapshot "$db" | jq '.' > "$tmp" 2>/dev/null; then
        mv "$tmp" "$reg"
    else
        rm -f "$tmp"
        return 1
    fi
}

# CAS retry loop: snapshot → jq → conditional write → view regen.
_soren_registry_update_unlocked() {
    local reg="$1" db="$2"
    shift 2

    _soren_registry_ensure_schema "$db" || return 1

    local attempt full input updated snap new ok
    for (( attempt = 0; attempt < 50; attempt++ )); do
        if ! full=$(_soren_registry_snapshot "$db"); then
            return 1
        fi

        # Fresh-install bootstrap (the ONLY path that treats the JSON file as
        # input): if the master is empty but a populated JSON registry exists
        # (pre-sqlite era), seed the update from it — mirrors the python
        # service's one-time JSON import. Skipped when the legacy
        # agent_registry.db is present (tools/migrate-state owns that path).
        input="$full"
        if [[ "$full" == "{}" && -s "$reg" && ! -f "$(dirname "$reg")/agent_registry.db" ]]; then
            local seeded
            if seeded=$(jq -ce 'select(type == "object")' "$reg" 2>/dev/null) && [[ -n "$seeded" ]]; then
                input="$seeded"
            fi
        fi

        if ! updated=$(jq "$@" <<<"$input"); then
            return 1
        fi
        # Refuse to replace the master with a non-object (broken filter)
        if [[ "$(jq -r 'type' <<<"$updated" 2>/dev/null)" != "object" ]]; then
            echo "soren_registry_update: filter produced a non-object — refusing to write" >&2
            return 1
        fi

        snap=$(mktemp) || return 1
        new=$(mktemp) || { rm -f "$snap"; return 1; }
        printf '%s' "$full" > "$snap"
        printf '%s' "$updated" > "$new"
        if ! ok=$(_soren_registry_cas_write "$db" "$snap" "$new"); then
            rm -f "$snap" "$new"
            return 1
        fi
        rm -f "$snap" "$new"

        if [[ "$ok" == "1" ]]; then
            _soren_registry_regen_view "$db" "$reg"
            return $?
        fi
        # Lost the CAS race — back off 10-90ms and retry on a fresh snapshot
        sleep "0.0$(( RANDOM % 9 + 1 ))"
    done
    echo "soren_registry_update: gave up after 50 CAS conflicts" >&2
    return 1
}

# Atomic read-modify-write of the agent registry.
# Usage: soren_registry_update <registry-file> [jq-args...] '<jq filter>'
# The jq filter runs against the full registry object materialized FROM the
# SQLite master; the result is written back to sqlite (CAS-serialized, see
# header comment) and the JSON view is regenerated afterwards. The signature
# is unchanged from the old JSON read-modify-write implementation.
soren_registry_update() {
    local reg="$1"
    shift
    local db
    db=$(_soren_registry_db_for "$reg")
    local run_dir="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}/.soren/run"
    mkdir -p "$run_dir" 2>/dev/null || true
    local lockfile="$run_dir/registry.lock"
    if command -v flock >/dev/null 2>&1; then
        # Belt only — sqlite CAS is the real serializer (flock is missing on
        # stock macOS, so nothing may rely on it for correctness).
        (
            flock 200
            _soren_registry_update_unlocked "$reg" "$db" "$@"
        ) 200>"$lockfile"
    else
        _soren_registry_update_unlocked "$reg" "$db" "$@"
    fi
}

# Read the registry from the SQLite master (NOT the JSON view). Use this in
# read→decide→write flows where a stale view would race a concurrent writer
# (python status sweeps, monitor port heals); plain display readers can keep
# using jq on agent_registry.json.
# Usage: soren_registry_get [jq-args...] ['<jq filter>']
# With no arguments, prints the full registry object. jq's exit status is
# propagated, so `-e` existence filters work.
soren_registry_get() {
    local root="${SOREN_HOME:-${SOREN_PROJECT_ROOT:-.}}"
    local db="${SOREN_DB:-${root}/.soren/soren.db}"
    local full="{}"
    if [[ -f "$db" ]]; then
        full=$(_soren_registry_snapshot "$db" 2>/dev/null) || full="{}"
        [[ -n "$full" ]] || full="{}"
    fi
    if [[ $# -eq 0 ]]; then
        jq '.' <<<"$full"
    else
        jq "$@" <<<"$full"
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
# session's time.created will be after our pre-send timestamp.
#
# VERIFIED: the session list is project-level (shared across all opencode
# instances in the same project directory — empirically confirmed by
# querying GET /session on ports 42006 and 42569 simultaneously and
# observing identical session lists). We use time.created to detect new
# sessions. False positives from concurrent spawns are not a practical risk:
# submit-prompt returning HTTP 200 already confirms the TUI accepted the
# text — this check adds defense-in-depth for the rare case where 200
# is returned but session creation is delayed.
#
# Usage: soren_oc_verify_prompt <port> <after_epoch_ms> [timeout-seconds]
# Returns 0 if any session was created after the given timestamp.
soren_oc_verify_prompt() {
    local port="$1"
    local after_ms="$2"
    local timeout="${3:-30}"
    local i

    for (( i = 0; i < timeout; i++ )); do
        sleep 1
        # Check if any session was created after our pre-send timestamp.
        # For cold TUI spawn: submit-prompt creates a new session.
        # Session list is project-level (shared), so a concurrent spawn
        # could also create a session — but that's acceptable: our HTTP
        # send already returned 200, this is just confirmation.
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
