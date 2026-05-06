#!/usr/bin/env bash
# tests/test_orchestrator.sh

set -e

echo "=== Testing soren orchestrator ==="

# Test 1: Start system
echo "Test 1: Starting system..."
./src/orchestrator/soren.sh start
sleep 10

# Test 2: Check status
echo "Test 2: Checking status..."
./src/orchestrator/soren.sh status

# Test 3: Verify tmux session
echo "Test 3: Verifying tmux session..."
tmux has-session -t soren && echo "PASS: tmux session exists" || echo "FAIL: no tmux session"

# Test 4: Verify server running
echo "Test 4: Verifying server..."
curl -sf http://localhost:8000/api/webhooks/health && echo "PASS: server healthy" || echo "FAIL: server not responding"

# Test 5: Stop system
echo "Test 5: Stopping system..."
./src/orchestrator/soren.sh stop
sleep 5

# Test 6: Verify stopped
echo "Test 6: Verifying stopped..."
! tmux has-session -t soren 2>/dev/null && echo "PASS: tmux session gone" || echo "FAIL: tmux session still exists"

echo "=== Tests complete ==="
