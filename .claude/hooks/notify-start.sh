#!/usr/bin/env bash
# Hook script: POST prompt-submit event to FastAPI
# Called by Claude Code UserPromptSubmit hook when agent receives input
#
# Only runs when SOREN_AGENT=true (set by orchestrator for managed agents)
# Uses SOREN_AGENT_NAME for human-readable agent identification
#
# Receives JSON on stdin with fields:
#   - session_id: identifies the agent
#   - transcript_path: full conversation JSONL file

# Exit early if not running as a SOREN-managed agent
[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -euo pipefail

# Configuration
SOREN_WEBHOOK_URL="${SOREN_WEBHOOK_URL:-http://localhost:8000/api/agent-events}"
AGENT_NAME="${SOREN_AGENT_NAME:-unknown}"

# Read JSON from stdin
input=$(cat)

# Extract session_id
session_id=$(echo "$input" | jq -r '.session_id // empty')

# Skip if no session_id
if [[ -z "$session_id" ]]; then
    exit 0
fi

# Build event payload
payload=$(jq -n \
    --arg event_type "UserPromptSubmit" \
    --arg agent_name "$AGENT_NAME" \
    --argjson hook_data "$input" \
    '{
        event_type: $event_type,
        session_id: $hook_data.session_id,
        agent_id: $agent_name
    }')

# POST to FastAPI (non-blocking, ignore errors)
curl -sf -X POST "$SOREN_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 5 \
    >/dev/null 2>&1 || true
