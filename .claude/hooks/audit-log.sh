#!/usr/bin/env bash
# Hook script: Append structured audit log entry for every tool call
# Called by Claude Code PostToolUse hook
#
# Appends a single JSON line to .soren/audit.log with:
#   timestamp, agent_name, tool_name, input_summary, session
#
# Reads hook input from stdin (JSON with tool_name, tool_input fields)
# Uses jq -c for compact output, >> for fast append
# Rotates audit.log when it exceeds 10MB (keeps 1 backup)

set -euo pipefail

# Resolve project root — prefer SOREN_HOME for workers in external directories
PROJECT_ROOT="${SOREN_HOME:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
AUDIT_LOG="$PROJECT_ROOT/.soren/audit.log"
MAX_SIZE=$((10 * 1024 * 1024))  # 10MB

# Log rotation: if audit.log exceeds 10MB, rotate to audit.log.1
if [[ -f "$AUDIT_LOG" ]]; then
    file_size=$(stat -f%z "$AUDIT_LOG" 2>/dev/null || stat -c%s "$AUDIT_LOG" 2>/dev/null || echo 0)
    if [[ "$file_size" -gt "$MAX_SIZE" ]]; then
        mv -f "$AUDIT_LOG" "${AUDIT_LOG}.1"
    fi
fi

# Read JSON from stdin
input=$(cat)

# Extract fields and build audit entry using jq -c (compact, single pass)
jq -c \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg agent "${SOREN_AGENT_NAME:-unknown}" \
    --arg session "${SOREN_SESSION:-soren}" \
    '{
        timestamp: $ts,
        agent_name: $agent,
        tool_name: .tool_name,
        input_summary: ((.tool_input // "" | tostring)[0:200]),
        session: $session
    }' <<< "$input" >> "$AUDIT_LOG" 2>/dev/null || true
