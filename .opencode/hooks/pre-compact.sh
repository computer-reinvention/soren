#!/usr/bin/env bash
# .opencode/hooks/pre-compact.sh
# Captures agent state before compaction for post-compact recovery.
# Called by compact.sh with window name as $1.
# Outputs the artifact file path on stdout.

set -euo pipefail

WINDOW="${1:-}"
[[ -z "$WINDOW" ]] && exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%H%M%S)
SOREN_SESSION="${SOREN_SESSION:-soren}"

# shellcheck source=/dev/null
source "${PROJECT_ROOT}/tools/lib/db.sh"

# Compaction artifacts go into the compacted agent's own journal scope --
# a team's own directory if WINDOW is a team member, otherwise the
# supervisor's global scope (matches tools/journal's scope resolution).
_team=""
if [[ -f "$SOREN_DB_PATH" ]]; then
    _team=$(soren_db "SELECT prefix FROM teams, json_each(teams.members)
        WHERE json_each.value = '$(printf '%s' "$WINDOW" | sed "s/'/''/g")' LIMIT 1;" 2>/dev/null || true)
fi
if [[ -n "$_team" ]]; then
    ARTIFACT_DIR="${PROJECT_ROOT}/.soren/journal/teams/${_team}/${TODAY}/artifacts"
else
    ARTIFACT_DIR="${PROJECT_ROOT}/.soren/journal/supervisor/${TODAY}/artifacts"
fi
ARTIFACT_FILE="${ARTIFACT_DIR}/compaction-${WINDOW}-${TIMESTAMP}.json"

mkdir -p "$ARTIFACT_DIR"

# Capture terminal output
terminal_output=$(tmux capture-pane -t "${SOREN_SESSION}:${WINDOW}" -p -S -50 2>/dev/null || echo "")

# Capture git state from the agent's actual working dir: prefer the
# registry's worktree_path, then worker_dir, then the project root.
GIT_TARGET="$PROJECT_ROOT"
REGISTRY="${PROJECT_ROOT}/.soren/agent_registry.json"
if [[ -f "$REGISTRY" ]]; then
    agent_dir=$(jq -r --arg k "$WINDOW" \
        '.[$k] | (.worktree_path // "") as $wt | (.worker_dir // "") as $wd | if $wt != "" then $wt elif $wd != "" then $wd else "" end' \
        "$REGISTRY" 2>/dev/null) || agent_dir=""
    if [[ -n "$agent_dir" && -d "$agent_dir" ]]; then
        GIT_TARGET="$agent_dir"
    fi
fi

git_branch=$(git -C "$GIT_TARGET" branch --show-current 2>/dev/null || echo "unknown")
uncommitted=$(git -C "$GIT_TARGET" diff --name-only 2>/dev/null || echo "")
staged=$(git -C "$GIT_TARGET" diff --cached --name-only 2>/dev/null || echo "")

# Capture current task from the tasks table (consolidated soren.db)
# (db.sh already sourced above for the team-scope lookup)
current_task=""
if [[ -f "$SOREN_DB_PATH" ]]; then
    current_task=$(soren_db \
        "SELECT id || ': ' || title FROM tasks WHERE (assigned_to='${WINDOW}' OR linked_workers LIKE '%${WINDOW}%') AND status IN ('in-progress', 'assigned') LIMIT 1;" \
        2>/dev/null || echo "")
fi

# Write artifact
jq -n \
    --arg window "$WINDOW" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg terminal "$terminal_output" \
    --arg branch "$git_branch" \
    --arg uncommitted "$uncommitted" \
    --arg staged "$staged" \
    --arg current_task "$current_task" \
    '{
        agent: $window,
        captured_at: $timestamp,
        terminal_snapshot: $terminal,
        git_branch: $branch,
        uncommitted_changes: ($uncommitted | split("\n") | map(select(. != ""))),
        staged_changes: ($staged | split("\n") | map(select(. != ""))),
        current_task: $current_task
    }' > "$ARTIFACT_FILE"

echo "$ARTIFACT_FILE"
