from fastapi import APIRouter, HTTPException
import asyncio
import logging

from ..models.project import Project, ProjectList, ProjectCreate, ProjectUpdate
from ..services.project_service import project_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=ProjectList)
async def list_projects():
    """List all registered projects."""
    projects = project_service.list_projects()
    return ProjectList(projects=projects, total=len(projects))


@router.post("", response_model=Project, status_code=201)
async def create_project(body: ProjectCreate):
    """Register a new project."""
    try:
        project = project_service.add_project(
            path=body.path,
            name=body.name,
            description=body.description,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return project


@router.get("/{project_id}", response_model=Project)
async def get_project(project_id: str):
    """Get details of a specific project."""
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=Project)
async def update_project(project_id: str, body: ProjectUpdate):
    """Update project metadata."""
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    project = project_service.update_project(project_id, updates)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    """Unregister a project. Deactivates first if active."""
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    try:
        # Deactivate first if active
        if project.active:
            project_service.set_active(project_id, False)

        removed = project_service.remove_project(project_id)
        if not removed:
            raise HTTPException(status_code=404, detail="Project not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"success": True, "project_id": project_id}


@router.get("/{project_id}/agents")
async def get_project_agents(project_id: str):
    """List agents belonging to a specific project."""
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    agents = project_service.get_project_agents(project_id)
    return {"project_id": project_id, "agents": agents, "total": len(agents)}


@router.post("/{project_id}/activate")
async def activate_project(project_id: str):
    """Activate a project (spawns project supervisor via CLI tool).

    For the self-project (soren), just marks it active.
    For external projects, shells out to `tools/projects activate`.
    """
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.active:
        return {"success": True, "project_id": project_id, "message": "Already active"}

    if project.is_self:
        updated = project_service.set_active(project_id, True)
        return {"success": True, "project_id": project_id, "project": updated}

    # For external projects, delegate to the CLI tool which handles
    # tmux window creation, Claude startup, and context injection
    try:
        proc = await asyncio.create_subprocess_exec(
            "./tools/projects", "activate", project_id,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        if proc.returncode != 0:
            error_msg = stderr.decode().strip() or "Activation failed"
            raise HTTPException(status_code=500, detail=error_msg)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Activation timed out")

    # Re-read the project state after activation
    updated = project_service.get_project(project_id)
    return {"success": True, "project_id": project_id, "project": updated}


@router.post("/{project_id}/deactivate")
async def deactivate_project(project_id: str):
    """Deactivate a project (kills project supervisor).

    For the self-project, just marks it inactive.
    For external projects, shells out to `tools/projects deactivate`.
    """
    project = project_service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.active:
        return {"success": True, "project_id": project_id, "message": "Already inactive"}

    if project.is_self:
        raise HTTPException(status_code=400, detail="Cannot deactivate SOREN self-project")

    try:
        proc = await asyncio.create_subprocess_exec(
            "./tools/projects", "deactivate", project_id,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            error_msg = stderr.decode().strip() or "Deactivation failed"
            raise HTTPException(status_code=500, detail=error_msg)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Deactivation timed out")

    updated = project_service.get_project(project_id)
    return {"success": True, "project_id": project_id, "project": updated}
