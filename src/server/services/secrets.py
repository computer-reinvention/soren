"""Encrypted secret storage using Fernet + PBKDF2-HMAC-SHA256, backed by SQLite.

The encrypted vault is a single row (id=1) in the secrets_vault table of the
consolidated database (.soren/soren.db):

    secrets_vault(id INTEGER PK CHECK(id=1), salt BLOB, blob BLOB, updated_at)

Crypto model UNCHANGED from the file era: the blob is an encrypted JSON dict
(Fernet), the key is derived from a passphrase via PBKDF2-HMAC-SHA256 with a
random salt (stored in the same row — the salt is not a secret). The
passphrase is NEVER written to disk.

Mutations run read→decrypt→mutate→encrypt→UPDATE under BEGIN IMMEDIATE, which
serializes concurrent writers — the legacy whole-file rewrite of
.soren/secrets.enc could lose a concurrently-written secret. The legacy files
(.soren/secrets.enc + .soren/.secrets-salt) are imported once, lazily, on
first access, then renamed *.migrated.
"""

import base64
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from ..config import settings
from . import db as db_service

PBKDF2_ITERATIONS = 600_000

_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS secrets_vault (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    salt       BLOB NOT NULL,
    blob       BLOB,
    updated_at TEXT
)
"""


def _legacy_salt_path() -> Path:
    return Path(settings.soren_dir) / ".secrets-salt"


def _legacy_enc_path() -> Path:
    return Path(settings.soren_dir) / "secrets.enc"


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _connect() -> sqlite3.Connection:
    """Open a connection with explicit transaction control and ensure schema."""
    conn = db_service.connect()
    conn.isolation_level = None  # autocommit; we issue BEGIN IMMEDIATE ourselves
    conn.execute(_TABLE_SQL)
    return conn


def _import_legacy_files(conn: sqlite3.Connection) -> None:
    """One-time lazy import of .soren/secrets.enc + .soren/.secrets-salt.

    Only runs while the vault row does not exist. INSERT OR IGNORE makes
    concurrent importers safe (they all read identical file contents); the
    files are renamed *.migrated afterwards so this never repeats.
    """
    if conn.execute("SELECT 1 FROM secrets_vault WHERE id = 1").fetchone():
        return
    salt_path = _legacy_salt_path()
    enc_path = _legacy_enc_path()
    if not salt_path.exists() and not enc_path.exists():
        return

    salt: bytes | None = None
    if salt_path.exists():
        try:
            salt = base64.b64decode(salt_path.read_bytes())
        except Exception:
            salt = None
    if not salt:
        # enc-without-salt is undecryptable either way; a fresh salt matches
        # the legacy behavior (which would have regenerated the salt file).
        salt = os.urandom(16)
    blob = enc_path.read_bytes() if enc_path.exists() else None

    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT OR IGNORE INTO secrets_vault (id, salt, blob, updated_at) "
            "VALUES (1, ?, ?, ?)",
            (salt, blob, _utcnow()),
        )
        conn.execute("COMMIT")
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise

    for path in (salt_path, enc_path):
        if path.exists():
            try:
                path.rename(path.with_name(path.name + ".migrated"))
            except OSError:
                pass


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))


def _get_or_create_salt(conn: sqlite3.Connection) -> bytes:
    row = conn.execute("SELECT salt FROM secrets_vault WHERE id = 1").fetchone()
    if row:
        return bytes(row["salt"])
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "INSERT OR IGNORE INTO secrets_vault (id, salt, blob, updated_at) "
            "VALUES (1, ?, NULL, ?)",
            (os.urandom(16), _utcnow()),
        )
        conn.execute("COMMIT")
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    row = conn.execute("SELECT salt FROM secrets_vault WHERE id = 1").fetchone()
    return bytes(row["salt"])


def _decrypt_vault(fernet: Fernet, blob: bytes | None) -> dict:
    if not blob:
        return {}
    try:
        return json.loads(fernet.decrypt(bytes(blob)))
    except InvalidToken:
        raise ValueError("Invalid passphrase")


def _fernet(conn: sqlite3.Connection, passphrase: str) -> Fernet:
    # KDF (the expensive part) runs OUTSIDE any write transaction — the salt
    # is immutable once created.
    return Fernet(_derive_key(passphrase, _get_or_create_salt(conn)))


def _read_vault(conn: sqlite3.Connection, fernet: Fernet) -> dict:
    row = conn.execute("SELECT blob FROM secrets_vault WHERE id = 1").fetchone()
    return _decrypt_vault(fernet, row["blob"] if row else None)


def set_secret(name: str, value: str, passphrase: str) -> None:
    """Encrypt and store a secret."""
    with closing(_connect()) as conn:
        _import_legacy_files(conn)
        fernet = _fernet(conn, passphrase)
        conn.execute("BEGIN IMMEDIATE")
        try:
            vault = _read_vault(conn, fernet)
            vault[name] = value
            conn.execute(
                "UPDATE secrets_vault SET blob = ?, updated_at = ? WHERE id = 1",
                (fernet.encrypt(json.dumps(vault).encode()), _utcnow()),
            )
            conn.execute("COMMIT")
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise


def get_secret(name: str, passphrase: str) -> str | None:
    """Decrypt and return a secret value, or None if not found."""
    with closing(_connect()) as conn:
        _import_legacy_files(conn)
        fernet = _fernet(conn, passphrase)
        return _read_vault(conn, fernet).get(name)


def list_secrets(passphrase: str) -> list[str]:
    """Return all secret names (not values)."""
    with closing(_connect()) as conn:
        _import_legacy_files(conn)
        fernet = _fernet(conn, passphrase)
        return sorted(_read_vault(conn, fernet).keys())


def delete_secret(name: str, passphrase: str) -> bool:
    """Delete a secret. Returns True if it existed."""
    with closing(_connect()) as conn:
        _import_legacy_files(conn)
        fernet = _fernet(conn, passphrase)
        conn.execute("BEGIN IMMEDIATE")
        try:
            vault = _read_vault(conn, fernet)
            if name not in vault:
                conn.execute("ROLLBACK")
                return False
            del vault[name]
            conn.execute(
                "UPDATE secrets_vault SET blob = ?, updated_at = ? WHERE id = 1",
                (fernet.encrypt(json.dumps(vault).encode()), _utcnow()),
            )
            conn.execute("COMMIT")
            return True
        except BaseException:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise