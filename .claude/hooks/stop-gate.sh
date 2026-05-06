#!/usr/bin/env bash
# Stop hook quality gate: ensures agents persist work before stopping
#
# Blocks agent shutdown if the agent used tools but didn't:
#   - Commit changes (git add + git commit)
#   - Journal work (./tools/journal)
#   - Report completion (./tools/mailbox)
#
# Receives JSON on stdin: {stop_hook_active, session_id, transcript_path, last_assistant_message}
# Returns JSON: {"decision": "block", "reason": "..."} to prevent stop
# Exit 0 silently to allow stop

set -euo pipefail

# Read JSON from stdin
input=$(cat)

# CRITICAL: If stop_hook_active is true, we're being re-invoked after a block.
# Exit immediately to prevent infinite loops.
stop_hook_active=$(echo "$input" | jq -r '.stop_hook_active // false')
if [[ "$stop_hook_active" == "true" ]]; then
    exit 0
fi

# Skip if not a SOREN agent
if [[ -z "${SOREN_AGENT_NAME:-}" ]]; then
    exit 0
fi

# Skip for supervisor — it has its own completion workflow
if [[ "${SOREN_AGENT_NAME}" == "supervisor" ]]; then
    exit 0
fi

# Skip for permanent workers during reset — their state is captured by the reset procedure
if [[ "${SOREN_AGENT_NAME}" == perm-* ]]; then
    local_reg_file="${SOREN_HOME:-.}/.soren/agent_registry.json"
    if [[ -f "$local_reg_file" ]]; then
        local_is_perm=$(jq -r --arg k "${SOREN_AGENT_NAME}" '.[$k].permanent // false' "$local_reg_file" 2>/dev/null)
        if [[ "$local_is_perm" == "true" ]]; then
            exit 0  # Allow stop — reset procedure handles state preservation
        fi
    fi
fi

# Get transcript path
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')

# If no transcript, allow stop
if [[ -z "$transcript_path" || ! -f "$transcript_path" ]]; then
    exit 0
fi

# Count total tool-use calls in the transcript
total_tool_calls=$(jq -s '
    [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] | length
' "$transcript_path" 2>/dev/null || echo "0")

# If very few tool calls (< 5), it was a short session — don't enforce
if [[ "$total_tool_calls" -lt 5 ]]; then
    exit 0
fi

# Check recent Bash tool calls for persistence actions
# Look at the last 200 lines of transcript for recent activity
recent_bash_inputs=$(tail -200 "$transcript_path" | jq -rs '
    [.[]? | select(.type == "assistant") | .message.content[]? |
     select(.type == "tool_use" and .name == "Bash") | .input.command // ""] | join("\n")
' 2>/dev/null || echo "")

# Check for git commit
has_commit=false
if echo "$recent_bash_inputs" | grep -qE 'git (commit|add.*&&.*commit)'; then
    has_commit=true
fi

# Check for journal entry
has_journal=false
if echo "$recent_bash_inputs" | grep -qE 'tools/journal|/journal'; then
    has_journal=true
fi

# Check for mailbox message
has_mailbox=false
if echo "$recent_bash_inputs" | grep -qE 'tools/mailbox|mailbox (done|blocked|send)'; then
    has_mailbox=true
fi

# If agent committed OR journaled, allow stop
if [[ "$has_commit" == "true" || "$has_journal" == "true" ]]; then
    exit 0
fi

# If agent sent mailbox message, allow stop
if [[ "$has_mailbox" == "true" ]]; then
    exit 0
fi

# Agent used tools but didn't persist — block
echo '{"decision":"block","reason":"Before stopping, you must: 1) Commit your changes (git add + git commit), 2) Journal your work (./tools/journal note), 3) Report completion (./tools/mailbox done). Do these now."}'
