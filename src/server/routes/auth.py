"""Auth endpoints: login, me, logout."""
from fastapi import APIRouter, Response, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..services.auth import authenticate_user, create_token, decode_token, init_db

router = APIRouter()

COOKIE_NAME = "soren_token"


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    """Validate credentials and return a JWT token (also sets HttpOnly cookie)."""
    init_db()
    if not authenticate_user(body.username, body.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(body.username)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # set True if behind HTTPS
        max_age=7 * 24 * 3600,
    )
    return {"token": token, "username": body.username}


@router.get("/me")
async def me(request: Request):
    """Return current user info from cookie or Authorization header."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    username = decode_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": username}


@router.post("/logout")
async def logout(response: Response):
    """Clear the auth cookie."""
    response.delete_cookie(key=COOKIE_NAME)
    return {"success": True}


def _extract_token(request: Request) -> str | None:
    """Extract token from cookie or Authorization Bearer header."""
    # Cookie first
    token = request.cookies.get(COOKIE_NAME)
    if token:
        return token
    # Authorization header
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None
