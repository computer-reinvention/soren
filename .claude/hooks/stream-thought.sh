#!/usr/bin/env bash
# PreToolUse hook: Stream agent reasoning to the SOREN dashboard
# Extracts the last assistant reasoning from the transcript and POSTs it
# as a live thought event. Async — must not block tool execution.

[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -uo pipefail

AGENT_NAME="${SOREN_AGENT_NAME:-unknown}"
THOUGHTS_URL="${SOREN_THOUGHTS_URL:-http://localhost:8000/api/thoughts}"

# Read hook JSON from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')
tool_input=$(echo "$input" | jq -r '.tool_input // empty' | head -c 500)
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

# Try to extract last assistant reasoning (thinking blocks only)
# We intentionally skip text blocks — those are visible responses, not internal reasoning
thought=""
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # First try: extract thinking blocks (Claude's internal reasoning)
    thought=$(tail -10 "$transcript_path" 2>/dev/null \
        | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="thinking") | .thinking' 2>/dev/null \
        | tail -1 \
        | head -c 500)
fi

# POST thought event (fail silently)
curl -sf -X POST "$THOUGHTS_URL" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg agent_name "$AGENT_NAME" \
        --arg thought_type "reasoning" \
        --arg content "$thought" \
        --arg tool_name "$tool_name" \
        --arg tool_input "$tool_input" \
        '{
            agent_name: $agent_name,
            thought_type: $thought_type,
            content: (if $content == "" then null else $content end),
            tool_name: $tool_name,
            tool_input: (if $tool_input == "" then null else $tool_input end)
        }')" \
    --max-time 5 \
    >/dev/null 2>&1 || true
