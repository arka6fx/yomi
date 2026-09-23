import json
import logging
import time
from urllib.parse import urlencode

import httpx

from yomi.conf import settings
from yomi.crypto import OAuthTokens

logger = logging.getLogger(__name__)

# Scope union the first-class Google connectors (Gmail, Calendar, Drive) need.
_GOOGLE_SCOPE = (
    "openid email profile "
    "https://www.googleapis.com/auth/gmail.modify "
    "https://www.googleapis.com/auth/calendar "
    "https://www.googleapis.com/auth/drive"
)


def _google_creds() -> tuple[str, str]:
    """Integrations OAuth client, falling back to the auth client's creds.

    Yomi uses a single Google Cloud project; deployments that did not create a
    dedicated integrations client reuse the Better Auth login client's id/secret
    so the connector flow still works against the same project.
    """
    client_id = settings.google_integrations_client_id or settings.google_auth_client_id
    client_secret = settings.google_integrations_client_secret or settings.google_auth_client_secret
    return client_id, client_secret


def build_auth_url(provider: str, user_id: str, redirect_uri: str) -> str:
    """Build the OAuth authorization URL for the given provider."""
    if provider == "google":
        client_id, _ = _google_creds()
        if not client_id:
            raise ValueError("Google OAuth credentials not configured")

        # State includes user_id to map the callback back to the user
        state = json.dumps({"user_id": user_id})

        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": _GOOGLE_SCOPE,
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    else:
        # Stub for other providers
        logger.warning(f"build_auth_url not fully implemented for {provider}")
        return f"https://stub.oauth.com/auth?provider={provider}"


async def handle_callback(provider: str, code: str, redirect_uri: str) -> OAuthTokens:
    """Exchange the authorization code for tokens."""
    if provider == "google":
        client_id, client_secret = _google_creds()
        if not client_id or not client_secret:
            raise ValueError("Google OAuth credentials not configured")
            
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "grant_type": "authorization_code",
                    "code": code,
                    "redirect_uri": redirect_uri,
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
            )
            
        if res.status_code != 200:
            raise RuntimeError(f"Google token exchange failed ({res.status_code}): {res.text}")
            
        data = res.json()
        expires_in = int(data.get("expires_in", 3600))
        return OAuthTokens(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_at=int(time.time() * 1000) + expires_in * 1000,
            token_type=data.get("token_type"),
            scope=data.get("scope"),
        )
    else:
        logger.warning(f"handle_callback not fully implemented for {provider}")
        return OAuthTokens(access_token="stub_token")
