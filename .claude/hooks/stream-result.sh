#!/usr/bin/env bash
# PostToolUse hook: Stream tool results to the SOREN dashboard
# Sends tool name + truncated response as a live thought event.
# Async — must not block tool execution.

[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -uo pipefail

AGENT_NAME="${SOREN_AGENT_NAME:-unknown}"
THOUGHTS_URL="${SOREN_THOUGHTS_URL:-http://localhost:8000/api/thoughts}"

# Read hook JSON from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
tool_response=$(echo "$input" | jq -r '.tool_response // empty' | head -c 500)

# POST thought event (fail silently)
curl -sf -X POST "$THOUGHTS_URL" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg agent_name "$AGENT_NAME" \
        --arg thought_type "tool_result" \
        --arg tool_name "$tool_name" \
        --arg tool_response "$tool_response" \
        '{
            agent_name: $agent_name,
            thought_type: $thought_type,
            tool_name: $tool_name,
            tool_response: (if $tool_response == "" then null else $tool_response end)
        }')" \
    --max-time 5 \
    >/dev/null 2>&1 || true
