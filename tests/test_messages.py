import pytest


def test_get_messages(client):
    response = client.get("/api/messages")
    assert response.status_code == 200
    assert "messages" in response.json()
    assert "total" in response.json()


def test_get_messages_with_limit(client):
    response = client.get("/api/messages?limit=10&offset=0")
    assert response.status_code == 200
    assert "messages" in response.json()


def test_send_user_message(client):
    payload = {
        "content": "Test message",
        "from_agent": "supervisor"
    }
    response = client.post("/api/messages/user", json=payload)
    assert response.status_code == 200
    assert response.json()["success"] is True
    assert "message_id" in response.json()


def test_store_internal_message(client):
    """Test the internal message endpoint used by router daemon."""
    payload = {
        "from_agent": "worker-test",
        "to_agent": "supervisor",
        "content": "Test internal message",
        "type": "mailbox"
    }
    response = client.post("/api/messages/internal", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "stored"
    assert "id" in response.json()


def test_store_internal_message_default_type(client):
    """Test internal message with default mailbox type."""
    payload = {
        "from_agent": "worker-a",
        "to_agent": "worker-b",
        "content": "Agent to agent message"
    }
    response = client.post("/api/messages/internal", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "stored"


def test_store_internal_message_with_task_status(client):
    """Test internal message with task_status field."""
    payload = {
        "from_agent": "worker-test",
        "to_agent": "supervisor",
        "content": "Task with status",
        "type": "mailbox",
        "task_status": "submitted"
    }
    response = client.post("/api/messages/internal", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "stored"
    assert "id" in data


def test_get_tasks_empty(client):
    """Test GET /tasks returns empty list when no tasks exist."""
    response = client.get("/api/messages/tasks")
    assert response.status_code == 200
    data = response.json()
    assert "messages" in data
    assert "total" in data


def test_get_tasks_with_status_filter(client):
    """Test GET /tasks with status filter."""
    # Store a message with task_status
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-a",
        "content": "Do task A",
        "task_status": "submitted"
    })
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-b",
        "content": "Do task B",
        "task_status": "working"
    })

    # Get all tasks
    response = client.get("/api/messages/tasks")
    assert response.status_code == 200
    assert response.json()["total"] >= 2

    # Filter by submitted
    response = client.get("/api/messages/tasks?status=submitted")
    assert response.status_code == 200
    for msg in response.json()["messages"]:
        assert msg["task_status"] == "submitted"

    # Filter by working
    response = client.get("/api/messages/tasks?status=working")
    assert response.status_code == 200
    for msg in response.json()["messages"]:
        assert msg["task_status"] == "working"


def test_update_message_status(client):
    """Test PATCH /{message_id}/status to update task lifecycle."""
    # Store a message with task_status
    response = client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-test",
        "content": "Lifecycle test task",
        "task_status": "submitted"
    })
    msg_id = response.json()["id"]

    # Update status to working
    response = client.patch(f"/api/messages/{msg_id}/status", json={
        "status": "working"
    })
    assert response.status_code == 200
    assert response.json()["task_status"] == "working"

    # Update status to completed
    response = client.patch(f"/api/messages/{msg_id}/status", json={
        "status": "completed"
    })
    assert response.status_code == 200
    assert response.json()["task_status"] == "completed"


def test_update_message_status_not_found(client):
    """Test updating status for non-existent message returns 404."""
    response = client.patch("/api/messages/nonexistent-id/status", json={
        "status": "working"
    })
    assert response.status_code == 404


def test_update_message_status_invalid(client):
    """Test updating with invalid status returns 422."""
    response = client.patch("/api/messages/some-id/status", json={
        "status": "invalid-status"
    })
    assert response.status_code == 422


def test_get_inbox_empty(client):
    """Test inbox for agent with no messages."""
    response = client.get("/api/messages/inbox/nonexistent-agent")
    assert response.status_code == 200
    data = response.json()
    assert data["pinned_task"] is None
    assert data["messages"] == []
    assert data["total"] == 0


def test_get_inbox_with_messages(client):
    """Test inbox returns messages involving the agent, ordered ASC."""
    # Send messages to and from the agent
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-inbox",
        "content": "Hello worker",
    })
    client.post("/api/messages/internal", json={
        "from_agent": "worker-inbox",
        "to_agent": "supervisor",
        "content": "Hello supervisor",
    })

    response = client.get("/api/messages/inbox/worker-inbox")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 2
    assert len(data["messages"]) >= 2
    # Verify ASC order — content we inserted should appear in order
    contents = [m["content"] for m in data["messages"]]
    hw_idx = contents.index("Hello worker")
    hs_idx = contents.index("Hello supervisor")
    assert hw_idx < hs_idx, "Messages should be in ASC timestamp order"


def test_get_inbox_pinned_task(client):
    """Test inbox returns first [TASK] message as pinned_task."""
    # Send a task assignment
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-pinned",
        "content": "[TASK] Fix the login bug",
    })
    # Send a follow-up task (should NOT be pinned — only first counts)
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-pinned",
        "content": "[TASK] Also fix the logout bug",
    })
    # Send a regular message
    client.post("/api/messages/internal", json={
        "from_agent": "worker-pinned",
        "to_agent": "supervisor",
        "content": "[STATUS] Working on it",
    })

    response = client.get("/api/messages/inbox/worker-pinned")
    assert response.status_code == 200
    data = response.json()
    assert data["pinned_task"] is not None
    assert data["pinned_task"]["content"] == "[TASK] Fix the login bug"
    assert data["total"] >= 3
    assert len(data["messages"]) >= 3


def test_get_inbox_no_pinned_task_without_task_prefix(client):
    """Test inbox returns null pinned_task when no [TASK] messages exist."""
    client.post("/api/messages/internal", json={
        "from_agent": "supervisor",
        "to_agent": "worker-notask",
        "content": "Just a regular message",
    })

    response = client.get("/api/messages/inbox/worker-notask")
    assert response.status_code == 200
    data = response.json()
    assert data["pinned_task"] is None
    assert data["total"] >= 1


def test_get_inbox_pagination(client):
    """Test inbox respects limit and offset params."""
    for i in range(5):
        client.post("/api/messages/internal", json={
            "from_agent": "supervisor",
            "to_agent": "worker-page",
            "content": f"Message {i}",
        })

    # Fetch with limit=2 — should return exactly 2 messages
    response = client.get("/api/messages/inbox/worker-page?limit=2&offset=0")
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 5
    assert len(data["messages"]) == 2

    # Fetch page 2
    response = client.get("/api/messages/inbox/worker-page?limit=2&offset=2")
    data = response.json()
    assert len(data["messages"]) == 2
