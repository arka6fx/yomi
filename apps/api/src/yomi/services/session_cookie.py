"""Better Auth session-cookie primitives (shared with the API auth seam).

Matches the live better-auth v1.2.x wire format that the dashboard's
@better-auth/react client speaks:

- `session.token` in the DB is a 32-char alphanumeric raw token.
- The cookie (`__Secure-yomi.session_token` in production, `yomi.session_token`
  otherwise) is hono's signed-cookie format: `<raw>.<hmac_sha256_hex(secret, raw)>`.

`recover_token` also understands the legacy better-auth <1.1.3 scheme where the
DB stored `<raw>.<hmac_sha256_hex(secret, json{"token": raw})>` and the cookie
was that full value, so pre-port sessions keep validating.
"""

from __future__ import annotations

import hashlib
import hmac as hmac_mod
import json
from typing import Any
from urllib.parse import urlparse

from fastapi import Request
from fastapi.responses import Response

from yomi.conf import settings

COOKIE_BASE = "yomi.session_token"


def hmac_hex(secret: str, data: str) -> str:
    return hmac_mod.new(secret.encode(), data.encode(), hashlib.sha256).hexdigest()


def sign_token(secret: str, raw: str) -> str:
    return f"{raw}.{hmac_hex(secret, raw)}"


def recover_token(secret: str, value: str) -> str | None:
    """Map a Better Auth signed-cookie value back to its session.token lookup key.

    Returns the raw token (current scheme) or the full signed value (legacy
    scheme) that should be matched against `session.token`, or None when the
    signature does not validate.
    """
    raw, sep, sig = value.rpartition(".")
    if not sep:
        return None
    if not secret:
        # local dev: signature skipped, treat the leading chunk as the token
        return raw
    if hmac_mod.compare_digest(sig, hmac_hex(secret, raw)):
        return raw
    body = json.dumps({"token": raw}, separators=(",", ":"))
    if hmac_mod.compare_digest(sig, hmac_hex(secret, body)):
        return value
    return None


def use_secure_cookies() -> bool:
    return settings.web_origin.startswith("https://")


def cookie_domain() -> str | None:
    web_host = urlparse(settings.web_origin).hostname or ""
    auth_host = urlparse(settings.backend_url).hostname or ""
    if web_host and auth_host != web_host and auth_host.endswith(f".{web_host}"):
        return f".{web_host}"
    return None


def session_cookie_options() -> dict[str, Any]:
    opts: dict[str, Any] = {
        "path": "/",
        "httponly": True,
        "samesite": "lax",
        "secure": use_secure_cookies(),
    }
    domain = cookie_domain()
    if domain:
        opts["domain"] = domain
    return opts


def session_cookie_name() -> str:
    prefix = "__Secure-" if use_secure_cookies() else ""
    return f"{prefix}{COOKIE_BASE}"


def read_session_cookie(request: Request) -> str | None:
    secure = f"__Secure-{COOKIE_BASE}"
    if secure in request.cookies:
        return request.cookies[secure]
    return request.cookies.get(COOKIE_BASE)


def set_session_cookie(response: Response, token: str, max_age: int | None = None) -> None:
    response.set_cookie(
        session_cookie_name(),
        sign_token(settings.better_auth_secret, token),
        max_age=max_age,
        **session_cookie_options(),
    )


def clear_session_cookie(response: Response) -> None:
    response.set_cookie(
        session_cookie_name(), "", max_age=0, **session_cookie_options()
    )