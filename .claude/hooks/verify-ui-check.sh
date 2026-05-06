#!/usr/bin/env bash
# verify-ui-check.sh — PostToolUse hook for UI task visual verification reminder
#
# When a UI/frontend worker sends [DONE] via ./tools/mailbox done, sends a
# one-time reminder to verify visually. Uses a flag file to avoid nagging —
# only reminds once per agent per session.
#
# Non-blocking (async). Does not affect message delivery.
#
# Receives JSON on stdin:
#   {tool_name, tool_input: {command: "..."}, tool_response: "...", session_id, transcript_path}

[[ "${SOREN_AGENT:-}" != "true" ]] && exit 0

set -euo pipefail

PROJECT_ROOT="${SOREN_HOME:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATUS_LOG="$PROJECT_ROOT/.soren/status.log"
MAILBOX_TOOL="$PROJECT_ROOT/tools/mailbox"
FLAG_DIR="$PROJECT_ROOT/.soren/.ui-check-flags"

input=$(cat)

# Only process Bash tool calls
tool_name=$(echo "$input" | jq -r '.tool_name // ""')
[[ "$tool_name" != "Bash" ]] && exit 0

# Tight match on ./tools/mailbox done only
command_str=$(echo "$input" | jq -r '(.tool_input.command // "") | tostring')
[[ "$command_str" != *"/tools/mailbox done "* && "$command_str" != *"/tools/mailbox done\""* ]] && exit 0

agent="${SOREN_AGENT_NAME:-unknown}"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Already reminded this agent? Let it be.
mkdir -p "$FLAG_DIR"
flag_file="$FLAG_DIR/$agent"
if [[ -f "$flag_file" ]]; then
    exit 0
fi

#--- Is this a UI task? Check agent name and role file ---

is_ui_task=false

case "$agent" in
    *frontend*|*-ui-*|*design*) is_ui_task=true ;;
esac

if [[ "$is_ui_task" == "false" ]]; then
    role_file="$PROJECT_ROOT/.soren/worker-contexts/${agent}-role.md"
    if [[ -f "$role_file" ]]; then
        if grep -qE '\bfrontend\b|\bCSS\b|\btailwind\b|\bReact\b|\b\.tsx\b|\bUI\b|\bvisual design\b|\blayout\b|\bcomponent\b' "$role_file" 2>/dev/null; then
            is_ui_task=true
        fi
    fi
fi

# Not a UI task — skip silently
[[ "$is_ui_task" == "false" ]] && exit 0

# Send one-time reminder and set flag
echo "$ts | UI_REMIND | $agent | sent visual verification reminder" >> "$STATUS_LOG"
touch "$flag_file"

"$MAILBOX_TOOL" send "$agent" \
    "[UI-CHECK] Reminder: please verify your UI changes visually before marking complete." \
    "Take a screenshot or use the browser MCP to confirm your changes look correct." \
    2>/dev/null || true

exit 0
