import pytest
import json
from pathlib import Path

from src.server.services.project_service import ProjectService


@pytest.fixture
def project_registry(tmp_path):
    """Create a temporary projects.json for testing."""
    projects_file = tmp_path / "projects.json"
    projects_file.write_text(json.dumps({
        "projects": [
            {
                "id": "soren",
                "name": "SOREN",
                "path": "/fake/path/soren",
                "is_self": True,
                "active": True,
                "supervisor_agent_id": "ag_0000prim",
                "hooks_installed": True,
                "added_at": "2026-02-20T00:00:00Z",
                "git_remote": "git@github.com:user/soren.git",
                "language": "python",
                "description": "Self-improving multi-agent system",
            }
        ]
    }))
    return projects_file


@pytest.fixture
def project_service(project_registry):
    """Create a ProjectService with a temp registry file."""
    return ProjectService(projects_file=project_registry)


@pytest.fixture
def service_on_app(project_registry, monkeypatch):
    """Monkeypatch the global project_service to use the temp file."""
    from src.server.services import project_service as ps_module
    svc = ProjectService(projects_file=project_registry)
    monkeypatch.setattr(ps_module, "project_service", svc)
    # Also patch the route module's import
    from src.server.routes import projects as projects_route
    monkeypatch.setattr(projects_route, "project_service", svc)
    return svc


# ── Service layer tests ──────────────────────────────────────────────────────

class TestProjectService:
    def test_list_projects(self, project_service):
        projects = project_service.list_projects()
        assert len(projects) == 1
        assert projects[0].id == "soren"
        assert projects[0].is_self is True

    def test_get_project(self, project_service):
        project = project_service.get_project("soren")
        assert project is not None
        assert project.name == "SOREN"

    def test_get_project_not_found(self, project_service):
        project = project_service.get_project("nonexistent")
        assert project is None

    def test_add_project(self, project_service, tmp_path):
        # Create a fake project directory
        proj_dir = tmp_path / "my-api"
        proj_dir.mkdir()
        (proj_dir / "pyproject.toml").write_text("[tool.poetry]\nname = 'my-api'")

        project = project_service.add_project(str(proj_dir), name="My API", description="Test API")
        assert project.id == "my-api"
        assert project.name == "My API"
        assert project.language == "python"
        assert project.active is False
        assert project.is_self is False

        # Verify it's persisted
        projects = project_service.list_projects()
        assert len(projects) == 2

    def test_add_duplicate_project(self, project_service, tmp_path):
        proj_dir = tmp_path / "my-api"
        proj_dir.mkdir()
        project_service.add_project(str(proj_dir))

        with pytest.raises(ValueError, match="already registered"):
            project_service.add_project(str(proj_dir))

    def test_add_nonexistent_path(self, project_service):
        with pytest.raises(ValueError, match="does not exist"):
            project_service.add_project("/fake/nonexistent/path")

    def test_update_project(self, project_service):
        updated = project_service.update_project("soren", {"description": "Updated description"})
        assert updated is not None
        assert updated.description == "Updated description"

        # Verify persistence
        project = project_service.get_project("soren")
        assert project.description == "Updated description"

    def test_update_project_not_found(self, project_service):
        result = project_service.update_project("nonexistent", {"name": "test"})
        assert result is None

    def test_remove_project(self, project_service, tmp_path):
        proj_dir = tmp_path / "removable"
        proj_dir.mkdir()
        project_service.add_project(str(proj_dir))
        assert len(project_service.list_projects()) == 2

        removed = project_service.remove_project("removable")
        assert removed is True
        assert len(project_service.list_projects()) == 1

    def test_remove_self_project(self, project_service):
        with pytest.raises(ValueError, match="self-project"):
            project_service.remove_project("soren")

    def test_remove_nonexistent_project(self, project_service):
        removed = project_service.remove_project("nonexistent")
        assert removed is False

    def test_set_active(self, project_service, tmp_path):
        proj_dir = tmp_path / "activatable"
        proj_dir.mkdir()
        project_service.add_project(str(proj_dir))

        result = project_service.set_active("activatable", True, supervisor_agent_id="ag_test1234")
        assert result is not None
        assert result.active is True
        assert result.supervisor_agent_id == "ag_test1234"

        result = project_service.set_active("activatable", False)
        assert result.active is False
        assert result.supervisor_agent_id is None

    def test_detect_language(self, tmp_path):
        # JavaScript
        js_dir = tmp_path / "js-project"
        js_dir.mkdir()
        (js_dir / "package.json").write_text("{}")
        assert ProjectService._detect_language(str(js_dir)) == "javascript"

        # Rust
        rs_dir = tmp_path / "rs-project"
        rs_dir.mkdir()
        (rs_dir / "Cargo.toml").write_text("")
        assert ProjectService._detect_language(str(rs_dir)) == "rust"

        # Unknown
        empty_dir = tmp_path / "empty"
        empty_dir.mkdir()
        assert ProjectService._detect_language(str(empty_dir)) == "unknown"


# ── API endpoint tests ────────────────────────────────────────────────────────

class TestProjectEndpoints:
    def test_list_projects(self, client, service_on_app):
        response = client.get("/api/projects")
        assert response.status_code == 200
        data = response.json()
        assert "projects" in data
        assert "total" in data
        assert data["total"] == 1
        assert data["projects"][0]["id"] == "soren"

    def test_get_project(self, client, service_on_app):
        response = client.get("/api/projects/soren")
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == "soren"
        assert data["is_self"] is True

    def test_get_project_not_found(self, client, service_on_app):
        response = client.get("/api/projects/nonexistent")
        assert response.status_code == 404

    def test_create_project(self, client, service_on_app, tmp_path):
        proj_dir = tmp_path / "new-proj"
        proj_dir.mkdir()
        (proj_dir / "package.json").write_text("{}")

        response = client.post("/api/projects", json={
            "path": str(proj_dir),
            "name": "New Project",
            "description": "A test project",
        })
        assert response.status_code == 201
        data = response.json()
        assert data["id"] == "new-proj"
        assert data["name"] == "New Project"
        assert data["language"] == "javascript"

    def test_create_duplicate_project(self, client, service_on_app, tmp_path):
        proj_dir = tmp_path / "dup-proj"
        proj_dir.mkdir()
        client.post("/api/projects", json={"path": str(proj_dir)})

        response = client.post("/api/projects", json={"path": str(proj_dir)})
        assert response.status_code == 400

    def test_update_project(self, client, service_on_app):
        response = client.patch("/api/projects/soren", json={
            "description": "New description",
        })
        assert response.status_code == 200
        assert response.json()["description"] == "New description"

    def test_update_project_not_found(self, client, service_on_app):
        response = client.patch("/api/projects/nonexistent", json={"name": "test"})
        assert response.status_code == 404

    def test_update_project_empty_body(self, client, service_on_app):
        response = client.patch("/api/projects/soren", json={})
        assert response.status_code == 400

    def test_delete_project(self, client, service_on_app, tmp_path):
        proj_dir = tmp_path / "deletable"
        proj_dir.mkdir()
        client.post("/api/projects", json={"path": str(proj_dir)})

        response = client.delete("/api/projects/deletable")
        assert response.status_code == 200
        assert response.json()["success"] is True

    def test_delete_self_project(self, client, service_on_app):
        response = client.delete("/api/projects/soren")
        assert response.status_code == 400

    def test_delete_project_not_found(self, client, service_on_app):
        response = client.delete("/api/projects/nonexistent")
        assert response.status_code == 404

    def test_get_project_agents(self, client, service_on_app):
        response = client.get("/api/projects/soren/agents")
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data
        assert "total" in data
        assert data["project_id"] == "soren"

    def test_get_project_agents_not_found(self, client, service_on_app):
        response = client.get("/api/projects/nonexistent/agents")
        assert response.status_code == 404


class TestAgentsByProject:
    def test_agents_by_project_endpoint(self, client):
        response = client.get("/api/agents/by-project/soren")
        assert response.status_code == 200
        data = response.json()
        assert "agents" in data
        assert "total" in data
        assert data["project_id"] == "soren"
