#!/usr/bin/env bash
# verify-done.sh — PostToolUse hook for self-verifying delegation
#
# When a worker sends [DONE] via ./tools/mailbox done, this hook:
# 1. Parses commit hash from the message body
# 2. Runs git show --stat to verify the commit exists
# 3. Runs pytest if .py files were changed
# 4. Runs typecheck if frontend files were changed
# 5. Sends [VERIFIED] / [VERIFY-FAILED] / [VERIFY-WARN] to supervisor
#
# Non-blocking: forks the verification into the background.
#
# Receives JSON on stdin:
#   {tool_name, tool_input: {command: "..."}, tool_response: "...", session_id, transcript_path}

[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -euo pipefail

PROJECT_ROOT="${SOREN_HOME:-$(git rev-parse --show-toplevel 2>/dev/null || true)}"
if [[ -z "$PROJECT_ROOT" ]]; then
    echo "verify-done.sh: cannot resolve project root (SOREN_HOME unset and not in a git repo)" >&2
    exit 0
fi
STATUS_LOG="$PROJECT_ROOT/.soren/status.log"
MAILBOX_TOOL="$PROJECT_ROOT/tools/mailbox"

# Consolidated DB access (soren_db + SOREN_DB_PATH; SOREN_DB env overrides the
# path — that is the sandboxing mechanism for tests, replacing the old
# RETRY_DIR override).
if [[ -f "$PROJECT_ROOT/tools/lib/db.sh" ]]; then
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/tools/lib/db.sh"
else
    echo "verify-done.sh: $PROJECT_ROOT/tools/lib/db.sh not found — cannot verify" >&2
    exit 0
fi

# Resolve GIT_ROOT for external projects (commits live in their own repo)
GIT_ROOT="$PROJECT_ROOT"
if [[ -n "${SOREN_PROJECT_ID:-}" && "${SOREN_PROJECT_ID:-}" != "soren" ]]; then
    _proj_json="$PROJECT_ROOT/.soren/projects.json"
    if [[ -f "$_proj_json" ]]; then
        _proj_path=$(jq -r --arg id "$SOREN_PROJECT_ID" '.projects[] | select(.id == $id) | .path // empty' "$_proj_json" 2>/dev/null) || true
        if [[ -n "$_proj_path" && -d "$_proj_path/.git" ]]; then
            GIT_ROOT="$_proj_path"
        fi
    fi
fi

# Fallback: if SOREN_PROJECT_ID was empty, try resolving commit across all registered projects
try_resolve_commit() {
    local hash="$1"
    # Try current GIT_ROOT first
    if git -C "$GIT_ROOT" show --stat --format="" "$hash" >/dev/null 2>&1; then
        return 0
    fi
    # Only search other projects if SOREN_PROJECT_ID was not set
    if [[ -n "${SOREN_PROJECT_ID:-}" ]]; then
        return 1
    fi
    local proj_json="$PROJECT_ROOT/.soren/projects.json"
    [[ -f "$proj_json" ]] || return 1
    local paths
    paths=$(jq -r '.projects[].path // empty' "$proj_json" 2>/dev/null) || return 1
    while IFS= read -r ppath; do
        [[ -z "$ppath" || "$ppath" == "$GIT_ROOT" ]] && continue
        [[ -d "$ppath/.git" ]] || continue
        if git -C "$ppath" show --stat --format="" "$hash" >/dev/null 2>&1; then
            GIT_ROOT="$ppath"
            return 0
        fi
    done <<< "$paths"
    return 1
}

input=$(cat)

# Only process Bash tool calls
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
[[ "$tool_name" != "Bash" ]] && exit 0

# Match ./tools/mailbox done only
command_str=$(echo "$input" | jq -r '(.tool_input.command // "") | tostring')
[[ "$command_str" != *"/tools/mailbox done "* && "$command_str" != *"/tools/mailbox done\""* ]] && exit 0

agent="${SOREN_AGENT_NAME:-unknown}"
supervisor="${SOREN_SUPERVISOR:-supervisor}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Extract the DONE message content from the command string
done_msg=$(echo "$command_str" | sed -n 's/.*\/tools\/mailbox done //p' | sed 's/^["'"'"']//;s/["'"'"']$//')

log_verify() {
    echo "$ts | [VERIFY] | $agent | $1" >> "$STATUS_LOG"
}

# --- Retry tracking for auto-fix ---
# Keyed by agent AND a task discriminator (TASK_KEY) so one flaky task can't
# burn another task's retry budget, and REJECT/FIX cycles stay bounded per
# task instead of resetting across rounds.
#
# State lives in the consolidated DB (fix_retries table) — the old per-task
# count files + .escalated latch files in .soren/.fix-retries/ raced under
# concurrent [DONE] reports (two backgrounded subshells could read the same
# count and both write count+1). A single UPSERT is atomic. The legacy dir is
# imported once, lazily (see migrate_fix_retries_dir), then renamed *.migrated.
LEGACY_RETRY_DIR="$PROJECT_ROOT/.soren/.fix-retries"
MAX_RETRIES=2

# Set in the background subshell after commit-hash extraction.
TASK_KEY=""

# Escape a value for embedding in a single-quoted SQL literal.
sql_q() {
    printf '%s' "$1" | sed "s/'/''/g"
}

# Schema for retry/latch state + structured verification history.
# NOTE (shared function): duplicated in tools/verifications — keep in sync.
ensure_verify_tables() {
    soren_db <<'SQL' 2>/dev/null || true
CREATE TABLE IF NOT EXISTS fix_retries (
    agent      TEXT NOT NULL,
    task_key   TEXT NOT NULL,
    retries    INTEGER NOT NULL DEFAULT 0,
    escalated  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (agent, task_key)
);
CREATE TABLE IF NOT EXISTS verify_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts         TEXT NOT NULL,
    event      TEXT NOT NULL,
    agent      TEXT NOT NULL,
    task_key   TEXT,
    commit_sha TEXT,
    detail     TEXT
);
SQL
}

# One-time lazy import of the legacy .fix-retries directory into fix_retries.
# mv is the atomic claim: exactly one concurrent invocation imports; the dir
# ends up renamed to <dir>.migrated so this never runs twice.
# NOTE (shared function): duplicated in tools/verifications — keep in sync.
migrate_fix_retries_dir() {
    local legacy="$1"
    [[ -d "$legacy" ]] || return 0
    local claim="${legacy}.importing.$$"
    mv "$legacy" "$claim" 2>/dev/null || return 0
    local now f base esc key agt count
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    for f in "$claim"/*; do
        [[ -e "$f" ]] || continue
        base=$(basename "$f")
        esc=0
        if [[ "$base" == *.escalated ]]; then
            esc=1
            base="${base%.escalated}"
        fi
        # <agent>-<key> where key is a commit sha / md5 (7-40 hex) or
        # "default"; legacy keyless files are just <agent>.
        key="${base##*-}"
        agt="${base%-*}"
        if [[ "$base" != *-* ]] || { [[ ! "$key" =~ ^[0-9a-f]{7,40}$ ]] && [[ "$key" != "default" ]]; }; then
            agt="$base"
            key="default"
        fi
        if (( esc == 1 )); then
            soren_db "INSERT INTO fix_retries (agent, task_key, retries, escalated, updated_at)
                VALUES ('$(sql_q "$agt")', '$(sql_q "$key")', 0, 1, '$now')
                ON CONFLICT(agent, task_key) DO UPDATE SET escalated = 1, updated_at = '$now';" 2>/dev/null || true
        else
            count=$(tr -cd '0-9' < "$f" 2>/dev/null) || count=""
            [[ -z "$count" ]] && count=0
            soren_db "INSERT INTO fix_retries (agent, task_key, retries, escalated, updated_at)
                VALUES ('$(sql_q "$agt")', '$(sql_q "$key")', $count, 0, '$now')
                ON CONFLICT(agent, task_key) DO UPDATE SET retries = $count, updated_at = '$now';" 2>/dev/null || true
        fi
    done
    if [[ -e "${legacy}.migrated" ]]; then
        mv "$claim" "${legacy}.migrated.$(date +%s).$$" 2>/dev/null || true
    else
        mv "$claim" "${legacy}.migrated" 2>/dev/null || true
    fi
}

# Structured verification history: one row per verification outcome, written
# alongside the human-readable status.log line. $1=event $2=detail [$3=commit]
record_event() {
    local now detail
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # Flatten whitespace: detail rows are read back as tab-separated columns.
    detail=$(printf '%s' "$2" | tr '\n\t' '  ')
    soren_db "INSERT INTO verify_events (ts, event, agent, task_key, commit_sha, detail)
        VALUES ('$now', '$(sql_q "$1")', '$(sql_q "$agent")',
                NULLIF('$(sql_q "${TASK_KEY:-}")', ''),
                NULLIF('$(sql_q "${3:-}")', ''),
                '$(sql_q "$detail")');" 2>/dev/null || true
}

_md5_stdin() {
    # Portable md5-of-stdin: md5sum (Linux), md5 -q (macOS), openssl fallback
    if command -v md5sum >/dev/null 2>&1; then
        md5sum | awk '{print $1}'
    elif command -v md5 >/dev/null 2>&1; then
        md5 -q
    else
        openssl md5 2>/dev/null | awk '{print $NF}'
    fi
}

compute_task_key() {
    # $1 = commit hash (may be empty). Prefer the reported commit hash as the
    # task discriminator; otherwise md5 of the normalized [DONE] summary
    # (first line, lowercased, whitespace-squeezed).
    if [[ -n "${1:-}" ]]; then
        echo "$1"
    else
        printf '%s' "$done_msg" | head -n 1 \
            | tr '[:upper:]' '[:lower:]' \
            | tr -s '[:space:]' ' ' \
            | sed 's/^ *//;s/ *$//' \
            | _md5_stdin
    fi
}

# WHERE clause for the current (agent, task key) row.
retry_where() {
    echo "agent = '$(sql_q "$agent")' AND task_key = '$(sql_q "${TASK_KEY:-default}")'"
}

get_retry_count() {
    local n
    n=$(soren_db "SELECT retries FROM fix_retries WHERE $(retry_where);" 2>/dev/null) || n=""
    echo "${n:-0}"
}

# Atomic increment: single UPSERT with RETURNING gives back the new count in
# one statement — concurrent [DONE] subshells can no longer lose increments.
# RETURNING needs sqlite3 >= 3.35 (stock macOS ships 3.51 — verified).
increment_retry() {
    local now n
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    n=$(soren_db "INSERT INTO fix_retries (agent, task_key, retries, escalated, updated_at)
        VALUES ('$(sql_q "$agent")', '$(sql_q "${TASK_KEY:-default}")', 1, 0, '$now')
        ON CONFLICT(agent, task_key) DO UPDATE SET retries = retries + 1, updated_at = '$now'
        RETURNING retries;" 2>/dev/null) || n=""
    echo "${n:-1}"
}

clear_retry() {
    soren_db "DELETE FROM fix_retries WHERE $(retry_where);" 2>/dev/null || true
}

is_latched() {
    local v
    v=$(soren_db "SELECT escalated FROM fix_retries WHERE $(retry_where);" 2>/dev/null) || v=""
    [[ "$v" == "1" ]]
}

should_auto_fix() {
    local count
    count=$(get_retry_count)
    (( count < MAX_RETRIES ))
}

send_fix_request() {
    local failure_type="$1"
    local details="$2"
    local count
    count=$(increment_retry)
    "$MAILBOX_TOOL" send "$agent" \
        "[FIX-REQUEST] ${failure_type}: attempt ${count}/${MAX_RETRIES}" \
        "$details" \
        2>/dev/null || true
    log_verify "FIX-REQUEST sent to $agent (attempt $count/$MAX_RETRIES): $failure_type"
    record_event "FIX-REQUEST" "${failure_type}: attempt ${count}/${MAX_RETRIES}" "${commit_hash:-}"
}

escalate_to_supervisor() {
    local failure_type="$1"
    local details="$2"
    local count
    count=$(get_retry_count)
    "$MAILBOX_TOOL" send "$supervisor" \
        "[VERIFY-FAILED] $agent: $failure_type ($count auto-fix attempts exhausted)" \
        "$details" \
        2>/dev/null || true
    log_verify "ESCALATED to supervisor after $count failed auto-fix attempts: $failure_type"
    record_event "VERIFY-FAILED" "$failure_type ($count auto-fix attempts exhausted)" "${commit_hash:-}"
    # Escalation latch: while escalated=1, further [DONE] reports for the same
    # task key get NO auto FIX-REQUEST (just a status.log line). Cleared by
    # `tools/verifications clear-latch`, or by `tools/workers send <agent>`
    # (a new dispatch means the supervisor intervened). Counter resets to 0 but
    # the latch survives (old behavior: rm count file, keep .escalated file).
    local esc_now
    esc_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    soren_db "INSERT INTO fix_retries (agent, task_key, retries, escalated, updated_at)
        VALUES ('$(sql_q "$agent")', '$(sql_q "${TASK_KEY:-default}")', 0, 1, '$esc_now')
        ON CONFLICT(agent, task_key) DO UPDATE SET retries = 0, escalated = 1, updated_at = '$esc_now';" 2>/dev/null || true
    # Log failure to API for tracking
    curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/messages/verify-result" \
      -H "Content-Type: application/json" \
      -d "{
        \"agent_id\": $(printf '%s' "$SOREN_AGENT_NAME" | jq -Rs .),
        \"result\": \"verify-failed\",
        \"commit_sha\": $(printf '%s' "${commit_hash:-unknown}" | jq -Rs .),
        \"details\": $(printf '%s' "$failure_type: $count auto-fix attempts exhausted" | jq -Rs .)
      }" >/dev/null 2>&1 || true
}

# --- Lesson extraction for Accumulated Knowledge ---
extract_lesson() {
    local retry_count="$1"
    local commit="${2:-}"
    local registry="$PROJECT_ROOT/.soren/agent_registry.json"

    # Look up role file path from registry
    local role_file=""
    if [[ -f "$registry" ]]; then
        role_file=$(jq -r --arg a "$agent" '.[$a].role_context // empty' "$registry" 2>/dev/null) || true
    fi
    # Fallback to common naming
    if [[ -z "$role_file" ]] || [[ ! -f "$role_file" ]]; then
        role_file="$PROJECT_ROOT/.soren/worker-contexts/${agent}-role.md"
    fi
    [[ -f "$role_file" ]] || return 0

    # Extract lesson text from DONE message
    local lesson_text=""
    if [[ -n "$commit" ]]; then
        # Strip leading commit hash and separator (— or -)
        lesson_text="${done_msg#*$commit}"
        lesson_text=$(echo "$lesson_text" | sed 's/^[[:space:]]*[^a-zA-Z0-9]*//')
    else
        lesson_text="$done_msg"
    fi
    # Truncate to first sentence
    lesson_text="${lesson_text%%.*}"
    # Cap length
    (( ${#lesson_text} > 80 )) && lesson_text="${lesson_text:0:77}..."
    # Fallback if empty
    [[ -z "$lesson_text" ]] && lesson_text="${done_msg:0:80}"

    # Build dated lesson line
    local today
    today=$(date -u +%Y-%m-%d)
    local lesson_line
    if (( retry_count > 0 )); then
        lesson_line="- [$today] ⚠ ${lesson_text} (needed ${retry_count} fix attempt(s))"
    else
        lesson_line="- [$today] ✓ ${lesson_text}"
    fi

    # Add section header if missing
    if ! grep -q '## Accumulated Knowledge' "$role_file" 2>/dev/null; then
        printf '\n## Accumulated Knowledge\n\n' >> "$role_file"
    fi

    # Append lesson
    echo "$lesson_line" >> "$role_file"

    # Cap at 20 entries — trim oldest if exceeded
    local section_line
    section_line=$(grep -n '## Accumulated Knowledge' "$role_file" | tail -1 | cut -d: -f1) || true
    if [[ -n "$section_line" ]]; then
        local entry_count
        entry_count=$(tail -n +"$section_line" "$role_file" | grep -c '^- \[') || entry_count=0
        if (( entry_count > 20 )); then
            local first_offset
            first_offset=$(tail -n +"$((section_line + 1))" "$role_file" | grep -n '^- \[' | head -1 | cut -d: -f1) || true
            if [[ -n "$first_offset" ]]; then
                local del_line=$((section_line + first_offset))
                local tmp="${role_file}.tmp.$$"
                awk -v dl="$del_line" 'NR != dl' "$role_file" > "$tmp" && mv "$tmp" "$role_file"
            fi
        fi
    fi

    log_verify "LESSON appended to $(basename "$role_file"): ${lesson_line}"
}

# --- Run verification in background ---
(
    # Retry/latch state and verification history live in the consolidated DB.
    # Ensure schema, then lazily import any pre-migration .fix-retries dir.
    ensure_verify_tables
    migrate_fix_retries_dir "$LEGACY_RETRY_DIR"

    # Extract commit hash: look for 7-40 hex char sequences
    commit_hash=""
    # Try full 40-char SHA first, then short 7+ char
    if [[ "$done_msg" =~ ([0-9a-f]{40}) ]]; then
        commit_hash="${BASH_REMATCH[1]}"
    elif [[ "$done_msg" =~ ([0-9a-f]{7,12}) ]]; then
        commit_hash="${BASH_REMATCH[1]}"
    fi

    # Per-task retry key: all retry/latch state below is scoped to this key.
    TASK_KEY=$(compute_task_key "$commit_hash")

    # Escalation latch: this task key already exhausted its retries and was
    # escalated. Do NOT restart the FIX-REQUEST cycle — wait for a supervisor
    # to intervene (clear-latch or dispatch via `workers send`).
    if is_latched; then
        log_verify "escalation latched, awaiting supervisor (agent $agent, key ${TASK_KEY})"
        record_event "LATCHED" "escalation latched, awaiting supervisor" "${commit_hash:-}"
        exit 0
    fi

    if [[ -z "$commit_hash" ]]; then
        # Contract exemption first: the compiled role contracts
        # (.soren/run/contracts.json, written by tools/contract compile) are
        # the runtime source of truth. done_requires_commit=false means this
        # agent legitimately reports DONE without a commit. Missing file or
        # missing entry -> fall through to the existing behavior unchanged.
        contract_exempt=false
        contracts_json="$PROJECT_ROOT/.soren/run/contracts.json"
        if [[ -f "$contracts_json" ]]; then
            # NOTE: no `// empty` here — jq's alternative operator would swallow
            # a literal `false`, which is exactly the value we're looking for.
            drc=$(jq -r --arg a "$agent" '.[$a].done_requires_commit' "$contracts_json" 2>/dev/null) || drc=""
            [[ "$drc" == "false" ]] && contract_exempt=true
        fi
        if [[ "$contract_exempt" == "true" ]]; then
            log_verify "SKIP: contract-exempt DONE from $agent (done_requires_commit=false in contracts.json)"
            record_event "SKIP-CONTRACT-EXEMPT" "contract-exempt DONE (done_requires_commit=false): ${done_msg:0:200}"
            retry_count_at_verify=$(get_retry_count)
            clear_retry
            "$MAILBOX_TOOL" send "$supervisor" \
                "[VERIFIED] $agent: task complete (contract-exempt, no commit required)" \
                "Contract-exempt completion: ${done_msg:0:200}" \
                2>/dev/null || true
            extract_lesson "$retry_count_at_verify" "" || true
            exit 0
        fi

        # Skip verification for research-only DONE messages (no code changes expected)
        # NOTE: plain assignments here — `local` is illegal outside a function
        # (this runs in a backgrounded subshell, not a function body).
        is_research=false
        if [[ "$agent" == *"research"* ]]; then
            # Check for research-answer keywords in the DONE message
            msg_lower=$(echo "$done_msg" | tr '[:upper:]' '[:lower:]')
            case "$msg_lower" in
                *"answer:"*|*"answer -"*|*"findings:"*|*"analysis"*|*"investigation"*|*"plan"*|*"saved to"*|*"research"*|*"no "*" found"*|*"does not exist"*)
                    is_research=true ;;
            esac
        fi

        # Canonical no-op protocol: output-only/verification tasks that changed
        # no code report "[DONE] no-op: <summary>". No commit is expected —
        # do NOT create empty commits and do NOT report HEAD's hash.
        # Reviewers are expected to reject abuse of this marker.
        msg_lower_noop=$(echo "$done_msg" | tr '[:upper:]' '[:lower:]')
        if [[ "$msg_lower_noop" == *"no-op:"* ]]; then
            log_verify "SKIP: no-op DONE from $agent (no commit expected)"
            record_event "SKIP-NOOP" "no-op DONE (no commit expected): ${done_msg:0:200}"
            retry_count_at_verify=$(get_retry_count)
            clear_retry
            "$MAILBOX_TOOL" send "$supervisor" \
                "[VERIFIED] ${agent}: no-op task complete (no commit expected)" \
                "No-op completion: ${done_msg:0:200}" 2>/dev/null || true
            exit 0
        fi

        if [[ "$is_research" == "true" ]]; then
            log_verify "SKIP: research-only DONE from $agent (no commit expected)"
            record_event "SKIP-RESEARCH" "research-only DONE (no commit expected): ${done_msg:0:200}"
            retry_count_at_verify=$(get_retry_count)
            clear_retry
            "$MAILBOX_TOOL" send "$supervisor" \
                "[VERIFIED] $agent: research task complete (no commit expected)" \
                "Research answer: ${done_msg:0:200}" \
                2>/dev/null || true
            extract_lesson "$retry_count_at_verify" "" || true
            exit 0
        fi

        log_verify "WARN: no commit hash in DONE message from $agent"
        if should_auto_fix; then
            send_fix_request "missing-commit" \
                "Your [DONE] message has no commit hash. Please:
1) git add <changed files>
2) git commit -m 'descriptive message'
3) Report again: ./tools/mailbox done '<summary INCLUDING the commit hash>'

Your original message: ${done_msg:0:200}"
        else
            escalate_to_supervisor "missing-commit" "Message: ${done_msg:0:200}"
        fi
        exit 0
    fi

    # Verify commit exists (searches all registered projects if SOREN_PROJECT_ID is empty)
    if ! try_resolve_commit "$commit_hash"; then
        log_verify "FAILED: commit $commit_hash not found in any project (agent: $agent)"
        changed_files=""
        if should_auto_fix; then
            send_fix_request "bad-commit" \
                "Commit $commit_hash not found in git history. Did you forget to push from a worktree?
1) Verify your commit: git log --oneline -5
2) If uncommitted: git add <files> && git commit
3) Report again with the correct hash: ./tools/mailbox done '<summary>'"
        else
            escalate_to_supervisor "bad-commit" "git show failed: ${changed_files:0:300}"
        fi
        exit 0
    fi

    # Commit found — get changed files from the resolved GIT_ROOT
    changed_files=$(git -C "$GIT_ROOT" show --stat --format="" "$commit_hash" 2>&1) || changed_files=""

    log_verify "commit $commit_hash verified in $GIT_ROOT, files: $(echo "$changed_files" | wc -l | tr -d ' ')"

    # Check for Python file changes -> run pytest
    has_py=false
    has_frontend=false
    if echo "$changed_files" | grep -q '\.py'; then
        has_py=true
    fi
    if echo "$changed_files" | grep -q 'src/frontend/'; then
        has_frontend=true
    fi

    verify_results="Commit $commit_hash exists. Changed files:\n$changed_files"
    verify_ok=true

    if $has_py; then
        log_verify "running pytest smoke test for $commit_hash"
        pytest_output=""
        if pytest_output=$(cd "$GIT_ROOT" && uv run pytest -x 2>&1); then
            log_verify "pytest PASSED for $commit_hash"
            verify_results="$verify_results\n\nPytest: PASSED"
        else
            log_verify "pytest FAILED for $commit_hash"
            verify_results="$verify_results\n\nPytest: FAILED\n${pytest_output:(-500)}"
            verify_ok=false
        fi
    fi

    if $has_frontend; then
        log_verify "running typecheck for $commit_hash"
        typecheck_output=""
        if typecheck_output=$(cd "$GIT_ROOT/src/frontend" && npm run typecheck 2>&1); then
            log_verify "typecheck PASSED for $commit_hash"
            verify_results="$verify_results\n\nTypecheck: PASSED"
        else
            log_verify "typecheck FAILED for $commit_hash"
            verify_results="$verify_results\n\nTypecheck: FAILED\n${typecheck_output:(-500)}"
            verify_ok=false
        fi
    fi

    # Send result — success clears retries, failure auto-fixes or escalates
    if $verify_ok; then
        retry_count_at_verify=$(get_retry_count)
        clear_retry
        record_event "VERIFIED" "commit $commit_hash checks passed" "$commit_hash"
        "$MAILBOX_TOOL" send "$supervisor" \
            "[VERIFIED] $agent: commit $commit_hash checks passed" \
            "$(printf '%b' "$verify_results" | head -30)" \
            2>/dev/null || true
        # Log verification success to API
        curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/messages/verify-result" \
          -H "Content-Type: application/json" \
          -d "{
            \"agent_id\": $(printf '%s' "$SOREN_AGENT_NAME" | jq -Rs .),
            \"result\": \"verified\",
            \"commit_sha\": $(printf '%s' "$commit_hash" | jq -Rs .)
          }" >/dev/null 2>&1 || true
        extract_lesson "$retry_count_at_verify" "$commit_hash" || true
    else
        if should_auto_fix; then
            send_fix_request "test-failure" \
                "Verification failed for commit $commit_hash:
$(printf '%b' "$verify_results" | tail -20)

Fix the failures, commit the fix, and report [DONE] again."
        else
            escalate_to_supervisor "test/typecheck failure" \
                "$(printf '%b' "$verify_results" | head -40)"
        fi
    fi

) &

exit 0
