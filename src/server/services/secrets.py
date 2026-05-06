"""Encrypted secret storage using Fernet + PBKDF2-HMAC-SHA256.

Secrets are stored as an encrypted JSON blob at .soren/secrets.enc.
The encryption key is derived from a passphrase using PBKDF2; the salt
is stored separately at .soren/.secrets-salt (not a secret itself).

The passphrase is NEVER written to disk.
"""

import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
import base64

from ..config import settings

PBKDF2_ITERATIONS = 600_000


def _salt_path() -> Path:
    return settings.soren_dir / ".secrets-salt"


def _enc_path() -> Path:
    return settings.soren_dir / "secrets.enc"


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))


def _get_or_create_salt() -> bytes:
    path = _salt_path()
    if path.exists():
        return base64.b64decode(path.read_bytes())
    salt = os.urandom(16)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(base64.b64encode(salt))
    return salt


def _load_vault(fernet: Fernet) -> dict:
    enc_path = _enc_path()
    if not enc_path.exists():
        return {}
    try:
        return json.loads(fernet.decrypt(enc_path.read_bytes()))
    except InvalidToken:
        raise ValueError("Invalid passphrase")


def _save_vault(fernet: Fernet, vault: dict) -> None:
    enc_path = _enc_path()
    enc_path.parent.mkdir(parents=True, exist_ok=True)
    enc_path.write_bytes(fernet.encrypt(json.dumps(vault).encode()))


def _fernet(passphrase: str) -> Fernet:
    salt = _get_or_create_salt()
    key = _derive_key(passphrase, salt)
    return Fernet(key)


def set_secret(name: str, value: str, passphrase: str) -> None:
    """Encrypt and store a secret."""
    f = _fernet(passphrase)
    vault = _load_vault(f)
    vault[name] = value
    _save_vault(f, vault)


def get_secret(name: str, passphrase: str) -> str | None:
    """Decrypt and return a secret value, or None if not found."""
    f = _fernet(passphrase)
    vault = _load_vault(f)
    return vault.get(name)


def list_secrets(passphrase: str) -> list[str]:
    """Return all secret names (not values)."""
    f = _fernet(passphrase)
    vault = _load_vault(f)
    return sorted(vault.keys())


def delete_secret(name: str, passphrase: str) -> bool:
    """Delete a secret. Returns True if it existed."""
    f = _fernet(passphrase)
    vault = _load_vault(f)
    if name not in vault:
        return False
    del vault[name]
    _save_vault(f, vault)
    return True
