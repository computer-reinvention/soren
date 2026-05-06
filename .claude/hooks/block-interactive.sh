#!/usr/bin/env bash
# PreToolUse hook: Block interactive tools for all unattended SOREN agents
#
# All SOREN agents (supervisor and workers) run in tmux windows with no
# human operator. Tools like AskUserQuestion and EnterPlanMode block
# forever waiting for input that will never come. This hook intercepts
# those calls and directs agents to use mailbox or text output instead.
#
# When blocking, this hook also rescues the assistant's text output from the
# current turn. Without this, the text is lost because the turn aborts before
# the Stop event fires (which is what normally delivers the message).
#
# Receives JSON on stdin: {tool_name, tool_input, transcript_path, ...}
# Exit 0 = allow, Exit 2 + stderr = block with message

set -euo pipefail

# Read hook JSON from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')

# Only block interactive tools
case "$tool_name" in
    AskUserQuestion|EnterPlanMode) ;;
    *) exit 0 ;;
esac

# Only block for SOREN agents (any agent running in the tmux session).
# Non-SOREN agents (local dev, no SOREN_AGENT_NAME set) are allowed through.
if [[ -z "${SOREN_AGENT_NAME:-}" ]]; then
    exit 0
fi

# --- Rescue lost message text before blocking ---
# When we block, the turn aborts and the Stop event never fires, so any text
# the assistant produced this turn would be silently dropped. Extract it from
# the transcript and POST it so it reaches the dashboard.
transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Extract text blocks from the last assistant message in the transcript
    rescued_text=$(tail -20 "$transcript_path" 2>/dev/null \
        | jq -r 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' 2>/dev/null \
        | tail -1)

    if [[ -n "$rescued_text" ]]; then
        MESSAGES_URL="${SOREN_MESSAGES_URL:-http://localhost:8000/api/messages/internal}"
        agent_name="${SOREN_AGENT_NAME}"

        # Detect [SYS] prefix — match the logic in agent_events.py
        msg_type="response"
        trimmed="${rescued_text#"${rescued_text%%[![:space:]]*}"}"
        if [[ "$trimmed" == "[SYS]"* ]]; then
            msg_type="system"
            rescued_text="${trimmed#\[SYS\]}"
            rescued_text="${rescued_text#"${rescued_text%%[![:space:]]*}"}"
        fi

        # Fire-and-forget POST (don't let failures block the hook)
        curl -sf -X POST "$MESSAGES_URL" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg from_agent "$agent_name" \
                --arg to_agent "user" \
                --arg content "$rescued_text" \
                --arg type "$msg_type" \
                '{from_agent: $from_agent, to_agent: $to_agent, content: $content, type: $type}')" \
            --max-time 3 \
            >/dev/null 2>&1 || true
    fi
fi

# Block the tool call — tailor the message to agent role
if [[ "${SOREN_AGENT_NAME}" == "supervisor" ]]; then
    echo 'BLOCKED: The supervisor cannot use interactive tools — you are running unattended in tmux. Instead, communicate questions via direct text output or send messages via mailbox: ./tools/mailbox send <recipient> "<message>". Make decisions autonomously and document them in the journal.' >&2
else
    echo 'BLOCKED: Workers cannot use interactive tools — you are running unattended. Instead, send a [REVIEW-REQUEST] to the supervisor via mailbox: ./tools/mailbox send supervisor "[REVIEW-REQUEST] <describe what you need reviewed and your proposed approach>" Then continue working with your best judgment. The supervisor will spawn a reviewer agent if needed.' >&2
fi
exit 2
