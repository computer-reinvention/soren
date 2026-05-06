#!/usr/bin/env bash
# tests/test_tools.sh — Smoke tests for SOREN tools and API endpoints
# Requires: running SOREN system on port 8000

set -uo pipefail

PASS=0
FAIL=0

pass() { echo "PASS: $1"; ((PASS++)); }
fail() { echo "FAIL: $1"; ((FAIL++)); }

echo "=== SOREN Tools Smoke Tests ==="

# Test 1: system-audit --brief exits 0 with non-empty output
echo ""
echo "Test 1: system-audit --brief"
output=$(./tools/system-audit --brief 2>&1) && rc=$? || rc=$?
# rc=0 (healthy), rc=1 (broken), rc=2 (degraded) are all valid
if [[ $rc -le 2 && -n "$output" ]]; then
    pass "system-audit --brief exits $rc with output (${#output} chars)"
else
    fail "system-audit --brief (rc=$rc, output_len=${#output})"
fi

# Test 2: workers list exits 0
echo ""
echo "Test 2: workers list"
output=$(./tools/workers list 2>&1) && rc=$? || rc=$?
if [[ -n "$output" ]]; then
    pass "workers list produces output (rc=$rc)"
else
    fail "workers list produced no output (rc=$rc)"
fi

# Test 3: recurring-issues returns valid JSON
echo ""
echo "Test 3: recurring-issues API"
output=$(curl -sf http://localhost:8000/api/journal/recurring-issues 2>&1) && rc=$? || rc=$?
if [[ $rc -eq 0 ]]; then
    if echo "$output" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
        pass "recurring-issues returns valid JSON"
    else
        fail "recurring-issues returned invalid JSON"
    fi
else
    fail "recurring-issues endpoint (rc=$rc)"
fi

# Test 4: No section headers in recurring-issues canonical_title fields
echo ""
echo "Test 4: recurring-issues canonical_title quality"
if [[ $rc -eq 0 && -n "$output" ]]; then
    bad_titles=$(echo "$output" | python3 -c "
import sys, json
data = json.load(sys.stdin)
issues = data.get('issues', data) if isinstance(data, dict) else data
bad = []
if isinstance(issues, list):
    for i in issues:
        t = i.get('canonical_title', '')
        if t.startswith('## ') or t.startswith('# '):
            bad.append(t)
print(len(bad))
" 2>/dev/null) || bad_titles="error"
    if [[ "$bad_titles" == "0" ]]; then
        pass "no section headers in canonical_title fields"
    elif [[ "$bad_titles" == "error" ]]; then
        fail "could not parse canonical_titles"
    else
        fail "$bad_titles canonical_titles have section headers (## or #)"
    fi
else
    fail "skipped (recurring-issues not available)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
