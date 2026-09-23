"""AES-256-GCM token encryption, wire-compatible with apps/api token-encryption.ts.

Layout: base64( 12-byte IV | 16-byte auth tag | ciphertext ).
Supports a primary ENCRYPTION_KEY and decrypt-only ENCRYPTION_KEY_FALLBACKS.
"""

from __future__ import annotations

import base64
import json
import os
import time
from dataclasses import dataclass

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from yomi.conf import settings

ALGO_IV_BYTES = 12
ALGO_TAG_BYTES = 16


class EncryptionKeyError(ValueError):
    """Raised when no usable encryption key is configured."""


@dataclass
class OAuthTokens:
    access_token: str
    refresh_token: str | None = None
    expires_at: int | None = None  # unix ms
    token_type: str | None = None
    scope: str | None = None


def _parse_key(hexish: str | None, label: str) -> bytes:
    if not hexish or len(hexish) != 64:
        raise EncryptionKeyError(f"{label} must be a 64-char hex string")
    return bytes.fromhex(hexish)


def _primary_key() -> bytes:
    return _parse_key(settings.encryption_key, "ENCRYPTION_KEY")


def _decrypt_keys() -> list[bytes]:
    keys = [_primary_key()]
    for entry in (settings.encryption_key_fallbacks or "").split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            keys.append(_parse_key(entry, "ENCRYPTION_KEY_FALLBACKS entry"))
        except EncryptionKeyError:
            # Skip malformed fallback entries rather than failing all decryption.
            continue
    return keys


def encrypt_string(plain: str) -> str:
    key = _primary_key()
    iv = os.urandom(ALGO_IV_BYTES)
    ciphertext_with_tag = AESGCM(key).encrypt(iv, plain.encode("utf-8"), None)
    # ciphertext_with_tag = ciphertext || tag (tag is final 16 bytes)
    tag = ciphertext_with_tag[-ALGO_TAG_BYTES:]
    ciphertext = ciphertext_with_tag[:-ALGO_TAG_BYTES]
    return base64.b64encode(iv + tag + ciphertext).decode("ascii")


def decrypt_string(ciphertext_b64: str) -> str:
    buf = base64.b64decode(ciphertext_b64)
    iv = buf[:ALGO_IV_BYTES]
    tag = buf[ALGO_IV_BYTES : ALGO_IV_BYTES + ALGO_TAG_BYTES]
    data = buf[ALGO_IV_BYTES + ALGO_TAG_BYTES :]
    last_err: BaseException | None = None
    for key in _decrypt_keys():
        try:
            aesgcm = AESGCM(key)
            plain = aesgcm.decrypt(iv, data + tag, None)
            return plain.decode("utf-8")
        except Exception as exc:  # auth tag mismatch (wrong key) -> try next candidate
            last_err = exc
    raise last_err if isinstance(last_err, Exception) else EncryptionKeyError("decryption failed")


def encrypt_tokens(tokens: OAuthTokens) -> str:
    return encrypt_string(json.dumps(tokens.__dict__))


def decrypt_tokens(ciphertext: str) -> OAuthTokens:
    return OAuthTokens(**json.loads(decrypt_string(ciphertext)))


async def refresh_google_access_token(refresh_token: str) -> OAuthTokens:
    """Refresh a Google access token using the stored refresh token."""
    client_id = settings.google_integrations_client_id
    client_secret = settings.google_integrations_client_secret
    if not client_id or not client_secret:
        raise EncryptionKeyError("Google OAuth credentials not configured")

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
                "client_secret": client_secret,
            },
        )

    if res.status_code != 200:
        raise RuntimeError(f"Google token refresh failed ({res.status_code}): {res.text}")

    data = res.json()
    expires_in = int(data.get("expires_in", 3600))
    return OAuthTokens(
        access_token=data["access_token"],
        refresh_token=refresh_token,  # Google rotates refresh tokens rarely; keep existing
        expires_at=int(time.time() * 1000) + expires_in * 1000,
        token_type=data.get("token_type"),
        scope=data.get("scope"),
    )