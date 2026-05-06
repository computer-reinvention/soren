#!/usr/bin/env bash
# Hook script: POST tool output to FastAPI
# Called by Claude Code PostToolUse hook
#
# Only runs when SOREN_AGENT=true (set by orchestrator for managed agents)
# Uses SOREN_AGENT_NAME for human-readable agent identification
#
# Receives JSON on stdin with fields:
#   - session_id: identifies the agent
#   - tool_name: what tool was called (Bash, Write, etc.)
#   - tool_input: command/content that was executed
#   - tool_response: output/result from the tool
#   - transcript_path: full conversation JSONL file

# Exit early if not running as a SOREN-managed agent
[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -euo pipefail

# Configuration
SOREN_WEBHOOK_URL="${SOREN_WEBHOOK_URL:-http://localhost:8000/api/agent-events}"
AGENT_NAME="${SOREN_AGENT_NAME:-unknown}"

# Read JSON from stdin
input=$(cat)

# Extract session_id as backup identifier
session_id=$(echo "$input" | jq -r '.session_id // empty')

# Skip if no session_id
if [[ -z "$session_id" ]]; then
    exit 0
fi

# Build event payload - use SOREN_AGENT_NAME for agent_id
payload=$(jq -n \
    --arg event_type "PostToolUse" \
    --arg agent_name "$AGENT_NAME" \
    --argjson hook_data "$input" \
    '{
        event_type: $event_type,
        session_id: $hook_data.session_id,
        agent_id: $agent_name,
        tool_name: $hook_data.tool_name,
        tool_input: $hook_data.tool_input,
        tool_output: $hook_data.tool_response,
        transcript_path: $hook_data.transcript_path
    }')

# POST to FastAPI (non-blocking, ignore errors)
curl -sf -X POST "$SOREN_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --max-time 5 \
    >/dev/null 2>&1 || true
