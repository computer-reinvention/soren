#!/usr/bin/env bash
# PreToolUse hook: Block supervisor from using Edit/Write/NotebookEdit directly
#
# The #1 recurring failure pattern is the supervisor writing code instead of
# delegating to workers. This hook makes it mechanically impossible.
#
# Only blocks the supervisor agent — workers edit freely.
# Allows exceptions for non-code files the supervisor legitimately edits:
#   .soren/*, MEMORY.md, reflection files, journal entries
#
# Receives JSON on stdin: {tool_name, tool_input, ...}
# Exit 0 = allow, Exit 2 + stderr = block with message

set -euo pipefail

# Only applies to the supervisor agent
if [[ "${SOREN_AGENT_NAME:-}" != "supervisor" ]]; then
    exit 0
fi

# Read hook JSON from stdin
input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // empty')

# Only block file-editing tools
case "$tool_name" in
    Edit|Write|NotebookEdit) ;;
    *) exit 0 ;;
esac

# Extract the target file path from tool_input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# If no file path (shouldn't happen for these tools), block to be safe
if [[ -z "$file_path" ]]; then
    echo 'BLOCKED: Supervisor cannot edit files directly. Delegate to a worker: ./tools/workers spawn <name> "<task>"' >&2
    exit 2
fi

# Allow exceptions — files the supervisor legitimately edits
# Normalize to absolute path for reliable matching
case "$file_path" in
    # .soren runtime state (journal, mailbox, config, worker contexts, etc.)
    */.soren/*)
        exit 0 ;;
    # Memory files
    */MEMORY.md|*/memory/*.md|*/memory/*)
        exit 0 ;;
    # Reflection files (daily working doc)
    */reflection.md|*/reflection-*.md)
        exit 0 ;;
esac

# Everything else is blocked — supervisor must delegate
echo "BLOCKED: Supervisor cannot edit files directly. File: ${file_path}" >&2
echo "Delegate to a permanent worker or spawn a new one:" >&2
echo "  ./tools/workers send <worker-name> \"[TASK] <describe the change needed>\"" >&2
echo "  ./tools/workers spawn <name> \"<task description>\"" >&2
exit 2
