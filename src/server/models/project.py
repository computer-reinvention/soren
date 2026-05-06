from pydantic import BaseModel
from typing import Optional


class Project(BaseModel):
    id: str
    name: str
    path: str
    is_self: bool = False
    active: bool = False
    supervisor_agent_id: Optional[str] = None
    hooks_installed: bool = False
    added_at: Optional[str] = None
    git_remote: Optional[str] = None
    language: Optional[str] = None
    description: Optional[str] = None


class ProjectList(BaseModel):
    projects: list[Project]
    total: int


class ProjectCreate(BaseModel):
    path: str
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    language: Optional[str] = None
    git_remote: Optional[str] = None
