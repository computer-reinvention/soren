"""Authentication service: SQLite-backed user store with bcrypt + JWT."""
import sqlite3
import secrets
import string
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path

import bcrypt
import jwt

logger = logging.getLogger(__name__)

AUTH_DB_PATH = Path(".soren/auth.db")
AUTH_SECRET_PATH = Path(".soren/.auth-secret")
TOKEN_EXPIRY_DAYS = 7


def _get_secret() -> str:
    """Read the JWT secret from disk, generating it if it doesn't exist."""
    if AUTH_SECRET_PATH.exists():
        return AUTH_SECRET_PATH.read_text().strip()
    secret = secrets.token_hex(32)
    AUTH_SECRET_PATH.parent.mkdir(parents=True, exist_ok=True)
    AUTH_SECRET_PATH.write_text(secret)
    AUTH_SECRET_PATH.chmod(0o600)
    return secret


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(AUTH_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the users table if it doesn't exist."""
    AUTH_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.commit()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def authenticate_user(username: str, password: str) -> bool:
    """Return True if username/password are valid."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE username = ?", (username,)
        ).fetchone()
    if row is None:
        return False
    return verify_password(password, row["password_hash"])


def create_token(username: str) -> str:
    """Create a signed JWT token valid for TOKEN_EXPIRY_DAYS days."""
    secret = _get_secret()
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRY_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str) -> str | None:
    """Decode and validate a JWT token. Returns username or None if invalid."""
    secret = _get_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        return payload.get("sub")
    except jwt.ExpiredSignatureError:
        logger.debug("Token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.debug(f"Invalid token: {e}")
        return None


# --- CLI helpers (called from tools/auth) ---

def add_user(username: str, password: str | None = None) -> str:
    """Add a user. Generates password if not provided. Returns the password."""
    if password is None:
        alphabet = string.ascii_letters + string.digits
        password = "".join(secrets.choice(alphabet) for _ in range(16))
    init_db()
    hashed = hash_password(password)
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, hashed),
        )
        conn.commit()
    return password


def remove_user(username: str) -> bool:
    """Remove a user. Returns True if removed, False if not found."""
    init_db()
    with _get_conn() as conn:
        cursor = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        conn.commit()
        return cursor.rowcount > 0


def list_users() -> list[dict]:
    """Return list of users (no password hashes)."""
    init_db()
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, username, created_at FROM users ORDER BY id"
        ).fetchall()
    return [dict(row) for row in rows]
