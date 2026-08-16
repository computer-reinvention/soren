#!/usr/bin/env bash
# .claude/hooks/pre-compact.sh
# Captures agent state before compaction for post-compact recovery.
# Called by compact.sh with window name as $1.
# Outputs the artifact file path on stdout.

set -euo pipefail

WINDOW="${1:-}"
[[ -z "$WINDOW" ]] && exit 0

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TODAY=$(date +%Y-%m-%d)
TIMESTAMP=$(date +%H%M%S)
ARTIFACT_DIR="${PROJECT_ROOT}/.soren/journal/${TODAY}/artifacts"
ARTIFACT_FILE="${ARTIFACT_DIR}/compaction-${WINDOW}-${TIMESTAMP}.json"
SOREN_SESSION="${SOREN_SESSION:-soren}"

mkdir -p "$ARTIFACT_DIR"

# Capture terminal output
terminal_output=$(tmux capture-pane -t "${SOREN_SESSION}:${WINDOW}" -p -S -50 2>/dev/null || echo "")

# Capture git state
git_branch=$(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo "unknown")
uncommitted=$(git -C "$PROJECT_ROOT" diff --name-only 2>/dev/null || echo "")
staged=$(git -C "$PROJECT_ROOT" diff --cached --name-only 2>/dev/null || echo "")

# Capture current task from tasks.db
current_task=""
DB="${PROJECT_ROOT}/.soren/tasks.db"
if [[ -f "$DB" ]]; then
    current_task=$(sqlite3 "$DB" \
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
