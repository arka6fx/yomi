"""User-uploaded images (profile pictures) kept in R2 behind the storage gateway."""

from __future__ import annotations

import re
import uuid

MAX_AVATAR_BYTES = 2 * 1024 * 1024
MEDIA_PREFIX = "/api/media/"
_KEY_RE = re.compile(r"^avatars/[A-Za-z0-9_-]{1,64}/[a-f0-9-]{36}\.(png|jpg|webp|gif)$")
_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}


class MediaError(ValueError):
    pass


def sniff(data: bytes) -> str | None:
    """Image extension from magic bytes; the client-sent type is never trusted."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def check_avatar(data: bytes) -> tuple[str, str]:
    """(extension, content type) for a valid upload, else MediaError."""
    if not data:
        raise MediaError("no image received")
    if len(data) > MAX_AVATAR_BYTES:
        raise MediaError("that image is over 2 MB")
    ext = sniff(data)
    if ext is None:
        raise MediaError("use a PNG, JPEG, WebP or GIF image")
    return ext, _TYPES[ext]


def avatar_key(user_id: str, ext: str) -> str:
    safe_user = re.sub(r"[^A-Za-z0-9_-]", "", user_id)[:64] or "user"
    return f"avatars/{safe_user}/{uuid.uuid4()}.{ext}"


def valid_key(key: str) -> bool:
    return bool(_KEY_RE.match(key))


def url_for(key: str) -> str:
    return MEDIA_PREFIX + key


def own_key(image: str | None, user_id: str) -> str | None:
    """The R2 key behind a user's current picture, when it's one we host for them."""
    if not image or not image.startswith(MEDIA_PREFIX):
        return None
    key = image[len(MEDIA_PREFIX):]
    safe_user = re.sub(r"[^A-Za-z0-9_-]", "", user_id)[:64]
    return key if valid_key(key) and key.startswith(f"avatars/{safe_user}/") else None
