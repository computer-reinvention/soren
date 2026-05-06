from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import secrets as secrets_svc

router = APIRouter()


class SetRequest(BaseModel):
    name: str
    value: str
    passphrase: str


class GetRequest(BaseModel):
    name: str
    passphrase: str


class ListRequest(BaseModel):
    passphrase: str


class DeleteRequest(BaseModel):
    name: str
    passphrase: str


def _wrap(fn, *args, **kwargs):
    """Call a secrets service function, mapping ValueError (bad passphrase) to 401."""
    try:
        return fn(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


@router.post("/set")
async def set_secret(body: SetRequest):
    """Encrypt and store a secret."""
    _wrap(secrets_svc.set_secret, body.name, body.value, body.passphrase)
    return {"ok": True, "name": body.name}


@router.post("/get")
async def get_secret(body: GetRequest):
    """Decrypt and return a secret value."""
    value = _wrap(secrets_svc.get_secret, body.name, body.passphrase)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Secret '{body.name}' not found")
    return {"name": body.name, "value": value}


@router.post("/list")
async def list_secrets(body: ListRequest):
    """List all secret names (not values)."""
    names = _wrap(secrets_svc.list_secrets, body.passphrase)
    return {"secrets": names, "count": len(names)}


@router.post("/delete")
async def delete_secret(body: DeleteRequest):
    """Delete a secret."""
    deleted = _wrap(secrets_svc.delete_secret, body.name, body.passphrase)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Secret '{body.name}' not found")
    return {"ok": True, "name": body.name}
