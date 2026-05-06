#!/usr/bin/env bash
# Post-commit hook: trigger pattern extraction + AMBITION verification
SOREN_HOME="${SOREN_HOME:-$(git rev-parse --show-toplevel)}"

# Pattern extraction (background, non-blocking)
if [[ -x "${SOREN_HOME}/tools/extract-patterns" ]]; then
    nohup "${SOREN_HOME}/tools/extract-patterns" > /dev/null 2>&1 &
fi

# AMBITION verification: if AMBITION.md was modified, run verify-goal
if git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null | grep -q 'AMBITION.md'; then
    if [[ -x "${SOREN_HOME}/tools/verify-goal" ]]; then
        # Extract latest version from AMBITION.md
        latest_ver=$(grep -oP '(?<=^## AMBITION v)\d+' "${SOREN_HOME}/.soren/AMBITION.md" 2>/dev/null | tail -1)
        if [[ -n "$latest_ver" ]]; then
            # Run in background to not block commit
            (
                cd "$SOREN_HOME"
                if output=$("${SOREN_HOME}/tools/verify-goal" --version "$latest_ver" --json 2>&1); then
                    # Success — log to journal
                    curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/journal/entry" \
                        -H "Content-Type: application/json" \
                        -d "{\"title\":\"verify-goal v${latest_ver}: PASS (post-commit)\",\"content\":\"All assertions passed after AMBITION.md commit.\"}" \
                        >/dev/null 2>&1 || true
                else
                    # Failure — log + alert
                    fail_count=$(echo "$output" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['summary']['stale'])" 2>/dev/null || echo "?")
                    curl -sf -X POST "http://localhost:${SOREN_PORT:-8000}/api/journal/entry" \
                        -H "Content-Type: application/json" \
                        -d "{\"title\":\"verify-goal v${latest_ver}: FAIL (post-commit)\",\"content\":\"${fail_count} stale assertion(s) after AMBITION.md commit.\"}" \
                        >/dev/null 2>&1 || true
                    "${SOREN_HOME}/tools/notify" "verify-goal v${latest_ver}: ${fail_count} assertion(s) FAILED after AMBITION.md commit" --level warning 2>/dev/null || true
                fi
            ) &
        fi
    fi
fi

exit 0
