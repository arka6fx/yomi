"""Better Auth-compatible OAuth + session endpoints (dashboard web login).

Port of the retired TS backend's Better Auth config (apps/backend/src/auth.ts)
plus the live wire contract the `@better-auth/react` client in apps/landing
speaks against v1.2.x:

  POST /api/auth/sign-in/social/{provider}   -> JSON {url, redirect}
  GET|POST /api/auth/callback/{provider}     -> 302 (+ Set-Cookie) or error redirect
  GET  /api/auth/get-session                 -> {session, user} | null
  POST /api/auth/sign-out                    -> {success: true}
  POST /api/auth/revoke-sessions             -> {status: true}

Sessions: `session.token` holds a 32-char alphanumeric raw token; the cookie
(`__Secure-yomi.session_token` in production, `yomi.session_token` otherwise)
carries `<raw>.<hmac_sha256_hex(secret, raw)>` exactly like Better Auth's hono
signed cookie, so yomi.app.deps can read it back. OAuth state is stored as a
single-use `verification` row keyed by identifier=state with a 10-minute
expiry, matching Better Auth's generateState/parseState.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.db.models_app2 import PlatformConnection
from yomi.db.models_auth import Account as AuthAccount
from yomi.db.models_auth import Session as AuthSession
from yomi.db.models_auth import User as AuthUser
from yomi.db.models_auth import Verification
from yomi.db_session import get_db_session
from yomi.services import auth_d1, billing_d1
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.credit_ledger import grant_credits
from yomi.services.entitlements import effective_plan_for_user
from yomi.services.privacy.consent import ConsentContext, record_consent_decision
from yomi.services.session_cookie import (
    clear_session_cookie,
    read_session_cookie,
    recover_token,
    set_session_cookie,
)
from yomi.shared.plans import get_plan
from yomi.shared.privacy import SIGNUP_DEFAULT_CONSENT_PURPOSES

logger = logging.getLogger(__name__)

router = APIRouter()

SESSION_LIFETIME = timedelta(days=7)
STATE_LIFETIME = timedelta(minutes=10)
TRIAL_LIFETIME = timedelta(days=30)
REGULAR_INTERACTION_LIMIT = 100
ID_CHARACTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

GOOGLE_SCOPES = "email profile openid"
GITHUB_SCOPES = "read:user user:email"
GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API = "https://api.github.com"


def _now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _gen_id(size: int = 32) -> str:
    return "".join(secrets.choice(ID_CHARACTERS) for _ in range(size))


def _base_user_id() -> str:
    return _gen_id()


def _telegram_webapp_user_id(init_data: str) -> str | None:
    """Validate Telegram Mini App init data and return its Telegram user id.

    Telegram signs the newline-joined query fields (except ``hash``) with a
    secret derived from the bot token.  Do this server-side: the browser's
    ``initDataUnsafe`` object is explicitly not an authentication credential.
    """
    if not init_data or not settings.telegram_bot_token:
        return None
    try:
        values = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
        received_hash = values.pop("hash")
        user = json.loads(values.get("user") or "{}")
        user_id = user.get("id")
        if not user_id:
            return None
        data_check_string = "\n".join(f"{key}={values[key]}" for key in sorted(values))
        secret = hmac.new(
            b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256
        ).digest()
        expected_hash = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
        return str(user_id) if hmac.compare_digest(received_hash, expected_hash) else None
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _default_error_url() -> str:
    return f"{settings.web_origin.rstrip('/')}/error"


def _provider_redirect_uri(provider: str) -> str:
    # Mirrors the legacy config: Google overrides its redirect URI to the API
    # host; GitHub falls back to Better Auth's default ({baseURL}/callback/github)
    # where baseURL = web origin (the landing worker proxies /api/* to the API).
    if provider == "google":
        return f"{settings.backend_url.rstrip('/')}/api/auth/callback/google"
    return f"{settings.web_origin.rstrip('/')}/api/auth/callback/github"


def _b64url_sha256(value: str) -> str:
    digest = hashlib.sha256(value.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _authorize_url(provider: str, state: str, code_verifier: str) -> str:
    if provider == "google":
        params = {
            "response_type": "code",
            "client_id": settings.google_auth_client_id,
            "redirect_uri": _provider_redirect_uri("google"),
            "scope": GOOGLE_SCOPES,
            "state": state,
            "prompt": "select_account",
            "include_granted_scopes": "true",
        }
        if code_verifier:
            params["code_challenge_method"] = "S256"
            params["code_challenge"] = _b64url_sha256(code_verifier)
        base = GOOGLE_AUTHORIZE_URL
    else:
        params = {
            "response_type": "code",
            "client_id": settings.github_auth_client_id,
            "redirect_uri": _provider_redirect_uri("github"),
            "scope": GITHUB_SCOPES,
            "state": state,
        }
        base = GITHUB_AUTHORIZE_URL
    return f"{base}?{urlencode(params)}"


async def _exchange_code(
    provider: str, code: str, code_verifier: str, redirect_uri: str
) -> dict[str, Any]:
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    headers = {"accept": "application/json"}
    if provider == "google":
        data["client_id"] = settings.google_auth_client_id
        data["client_secret"] = settings.google_auth_client_secret
        if code_verifier:
            data["code_verifier"] = code_verifier
        url = GOOGLE_TOKEN_URL
    else:
        data["client_id"] = settings.github_auth_client_id
        data["client_secret"] = settings.github_auth_client_secret
        url = GITHUB_TOKEN_URL
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, data=data, headers=headers)
        resp.raise_for_status()
        token_data = resp.json()
    expires_in = token_data.get("expires_in")
    return {
        "accessToken": token_data.get("access_token"),
        "refreshToken": token_data.get("refresh_token"),
        "idToken": token_data.get("id_token"),
        "accessTokenExpiresAt": (
            _now_naive() + timedelta(seconds=int(expires_in)) if expires_in else None
        ),
        "scopes": token_data.get("scope", "").split(" ") if token_data.get("scope") else [],
    }


def _decode_id_token(id_token: str) -> dict[str, Any] | None:
    try:
        payload = id_token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        return json.loads(decoded)
    except Exception:
        return None


def _account_tokens_payload(tokens: dict[str, Any]) -> dict[str, Any]:
    """Map exchanged provider tokens onto the Account model's snake_case columns."""
    return {
        "access_token": tokens.get("accessToken"),
        "id_token": tokens.get("idToken"),
        "refresh_token": tokens.get("refreshToken"),
        "access_token_expires_at": tokens.get("accessTokenExpiresAt"),
        "refresh_token_expires_at": None,
        "scope": " ".join(tokens.get("scopes") or []),
    }


async def _provider_user(provider: str, tokens: dict[str, Any]) -> dict[str, Any] | None:
    """Map provider profile to the better-auth userInfo shape."""
    if provider == "google":
        id_token = tokens.get("idToken")
        if not id_token:
            return None
        payload = _decode_id_token(id_token)
        if not payload or not payload.get("sub"):
            return None
        return {
            "id": str(payload["sub"]),
            "name": payload.get("name"),
            "email": payload.get("email"),
            "image": payload.get("picture"),
            "emailVerified": bool(payload.get("email_verified")),
        }
    # github
    access_token = tokens.get("accessToken")
    if not access_token:
        return None
    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "better-auth",
        "Accept": "application/vnd.github+json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        user_resp = await client.get(f"{GITHUB_API}/user", headers=headers)
        if user_resp.status_code != 200:
            return None
        profile = user_resp.json()
        emails_resp = await client.get(f"{GITHUB_API}/user/emails", headers=headers)
        emails = emails_resp.json() if emails_resp.status_code == 200 else []
    email = profile.get("email")
    if not email and isinstance(emails, list) and emails:
        email = next((e.get("email") for e in emails if e.get("primary")), emails[0].get("email"))
    email_verified = False
    if isinstance(emails, list):
        match = next((e for e in emails if e.get("email") == email), None)
        email_verified = bool(match and match.get("verified"))
    return {
        "id": str(profile.get("id", "")),
        "name": profile.get("name") or profile.get("login"),
        "email": email,
        "image": profile.get("avatar_url"),
        "emailVerified": email_verified,
    }


def _iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _session_payload(sess: AuthSession) -> dict[str, Any]:
    return {
        "id": sess.id,
        "token": sess.token,
        "userId": sess.user_id,
        "expiresAt": _iso(sess.expires_at),
        "ipAddress": sess.ip_address,
        "userAgent": sess.user_agent,
        "createdAt": _iso(sess.created_at),
        "updatedAt": _iso(sess.updated_at),
    }


def _user_payload(user: AuthUser) -> dict[str, Any]:
    merged = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "emailVerified": user.email_verified,
        "image": user.image,
        "createdAt": _iso(user.created_at),
        "updatedAt": _iso(user.updated_at),
        "role": user.role or "user",
        "plan": effective_plan_for_user(
            {"id": user.id, "email": user.email, "plan": user.plan}
        ),
        "subscriptionStatus": user.subscription_status or "inactive",
        "trialStartDate": _iso(user.trial_start_date),
        "trialEndDate": _iso(user.trial_end_date),
        "currentPeriodEnd": _iso(user.current_period_end),
        "dodoCustomerId": user.dodo_customer_id,
        "dodoSubscriptionId": user.dodo_subscription_id,
        "trialInteractionUsed": user.trial_interaction_used or 0,
        "trialInteractionLimit": user.trial_interaction_limit or REGULAR_INTERACTION_LIMIT,
        "dailyChatCount": user.daily_chat_count or 0,
        "dailyVoiceCount": user.daily_voice_count or 0,
        "dailyImageCount": user.daily_image_count or 0,
        "agentUsageCount": user.agent_usage_count or 0,
        "dailyResetDate": user.daily_reset_date,
        "deletedAt": _iso(user.deleted_at),
        "agentSoul": user.agent_soul,
    }
    return merged


async def _resolve_session(
    request: Request, db: AsyncSession
) -> tuple[AuthSession | None, AuthUser | None, str | None]:
    """Validate the request's session cookie and return (session, user, cookie_value)."""
    value = read_session_cookie(request)
    if not value:
        return None, None, None
    token = recover_token(settings.better_auth_secret, value)
    if not token:
        return None, None, value
    sess = (
        await db.execute(select(AuthSession).where(AuthSession.token == token).limit(1))
    ).scalar_one_or_none()
    if not sess:
        return None, None, value
    expires = sess.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        await db.execute(delete(AuthSession).where(AuthSession.id == sess.id))
        return None, None, value
    user = (
        await db.execute(select(AuthUser).where(AuthUser.id == sess.user_id).limit(1))
    ).scalar_one_or_none()
    return sess, user, value


async def _create_social_state(
    db: AsyncSession, provider: str, body: dict[str, Any],
    d1: D1Backend | None = None,
) -> JSONResponse:
    if provider not in ("google", "github"):
        return JSONResponse(
            {"error": {"message": "Provider not found", "status": 404}},
            status_code=404,
        )
    callback_url = body.get("callbackURL") or settings.web_origin.rstrip("/")
    code_verifier = _gen_id(128)
    state = _gen_id(32)
    state_payload = {
        "callbackURL": callback_url,
        "codeVerifier": code_verifier,
        "errorURL": body.get("errorCallbackURL"),
        "newUserURL": body.get("newUserCallbackURL"),
        "link": None,
        "expiresAt": _now_ms() + int(STATE_LIFETIME.total_seconds() * 1000),
        "requestSignUp": bool(body.get("requestSignUp")),
    }
    now = _now_naive()
    if d1 is not None:
        await auth_d1.create_verification(
            d1,
            identifier=state,
            value=json.dumps(state_payload),
            expires_at=(datetime.now(UTC) + STATE_LIFETIME).isoformat(),
            now=datetime.now(UTC).isoformat(),
        )
    else:
        db.add(
            Verification(
                id=_gen_id(),
                identifier=state,
                value=json.dumps(state_payload),
                expires_at=now + STATE_LIFETIME,
                created_at=now,
                updated_at=now,
            )
        )
    url = _authorize_url(provider, state, code_verifier)
    return JSONResponse({"url": url, "redirect": not bool(body.get("disableRedirect"))})


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        body = {}
    return body if isinstance(body, dict) else {}


@router.post("/sign-in/social")
async def sign_in_social(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    body = await _json_body(request)
    provider = body.get("provider") or ""
    return await _create_social_state(db, str(provider), body, d1)


@router.post("/sign-in/social/{provider}")
async def sign_in_social_for_provider(
    provider: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    body = await _json_body(request)
    return await _create_social_state(db, provider, body, d1)


async def _callback_params(request: Request) -> dict[str, Any]:
    fields: dict[str, Any] = dict(request.query_params)
    if request.method == "POST":
        content_type = request.headers.get("content-type", "")
        try:
            if "application/json" in content_type:
                body = await request.json()
            else:
                form = await request.form()
                body = dict(form)
        except Exception:
            body = {}
        if isinstance(body, dict):
            fields.update(body)
    return fields


@router.get("/callback/{provider}", response_model=None)
@router.post("/callback/{provider}", response_model=None)
async def oauth_callback(
    provider: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> RedirectResponse | JSONResponse:
    fields = await _callback_params(request)
    default_error = _default_error_url()

    oauth_error = fields.get("error")
    if oauth_error:
        url = f"{default_error}?error={oauth_error}"
        error_description = fields.get("error_description")
        if error_description:
            url += f"&error_description={error_description}"
        return RedirectResponse(url, status_code=302)

    state = fields.get("state")
    if not state:
        return RedirectResponse(f"{default_error}?error=state_not_found", status_code=302)

    if d1 is not None:
        return await _oauth_callback_d1(provider, request, d1, fields, str(state))

    verification = (
        await db.execute(
            select(Verification).where(Verification.identifier == str(state)).limit(1)
        )
    ).scalar_one_or_none()

    def restart_process() -> RedirectResponse:
        if verification is not None:
            db.delete(verification)
        url = f"{default_error}?error=please_restart_the_process"
        return RedirectResponse(url, status_code=302)

    if verification is None:
        return restart_process()
    try:
        state_data = json.loads(verification.value)
    except Exception:
        return restart_process()
    expires_at = state_data.get("expiresAt")
    if not isinstance(expires_at, int) or expires_at < _now_ms():
        return restart_process()
    db.delete(verification)

    error_url = state_data.get("errorURL") or default_error
    new_user_url = state_data.get("newUserURL")
    callback_url = state_data.get("callbackURL")
    code_verifier = state_data.get("codeVerifier")
    if not isinstance(callback_url, str) or not callback_url:
        callback_url = None

    def redirect_on_error(code: str) -> RedirectResponse:
        sep = "&" if "?" in error_url else "?"
        return RedirectResponse(f"{error_url}{sep}error={code}", status_code=302)

    code = fields.get("code")
    if not code:
        return redirect_on_error("no_code")
    if provider not in ("google", "github"):
        return redirect_on_error("oauth_provider_not_found")

    redirect_uri = _provider_redirect_uri(provider)
    try:
        tokens = await _exchange_code(provider, str(code), code_verifier or "", redirect_uri)
    except Exception as exc:
        logger.warning("[auth] token exchange failed for %s: %s", provider, exc)
        return redirect_on_error("invalid_code")

    user_info = await _provider_user(provider, tokens)
    if not user_info:
        return redirect_on_error("unable_to_get_user_info")
    if not user_info.get("email"):
        return redirect_on_error("email_not_found")
    if not callback_url:
        return redirect_on_error("no_callback_url")

    email = str(user_info["email"]).lower()
    account_id = str(user_info["id"])
    now = _now_naive()
    db_user = (
        await db.execute(select(AuthUser).where(AuthUser.email == email).limit(1))
    ).scalar_one_or_none()

    is_register = db_user is None
    account_tokens = _account_tokens_payload(tokens)

    if db_user is not None:
        existing_account = (
            await db.execute(
                select(AuthAccount)
                .where(
                    AuthAccount.user_id == db_user.id,
                    AuthAccount.provider_id == provider,
                    AuthAccount.account_id == account_id,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if existing_account is None:
            if not user_info.get("emailVerified"):
                return redirect_on_error("account_not_linked")
            db.add(
                AuthAccount(
                    id=_gen_id(),
                    account_id=account_id,
                    provider_id=provider,
                    user_id=db_user.id,
                    created_at=now,
                    updated_at=now,
                    **account_tokens,
                )
            )
        else:
            await db.execute(
                update(AuthAccount)
                .where(AuthAccount.id == existing_account.id)
                .values(updated_at=now, **account_tokens)
            )
    else:
        db_user = AuthUser(
            id=_base_user_id(),
            name=(user_info.get("name") or email) or "",
            email=email,
            email_verified=bool(user_info.get("emailVerified")),
            image=user_info.get("image"),
            created_at=now,
            updated_at=now,
            plan="explore",
            role="user",
            subscription_status="inactive",
            trial_interaction_limit=REGULAR_INTERACTION_LIMIT,
            trial_start_date=now,
            trial_end_date=now + TRIAL_LIFETIME,
        )
        db.add(db_user)
        db.add(
            AuthAccount(
                id=_gen_id(),
                account_id=account_id,
                provider_id=provider,
                user_id=db_user.id,
                created_at=now,
                updated_at=now,
                **account_tokens,
            )
        )
        await _apply_signup_side_effects(db, db_user, now)

    session_row = AuthSession(
        id=_gen_id(),
        expires_at=now + SESSION_LIFETIME,
        token=_gen_id(32),
        created_at=now,
        updated_at=now,
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent") or "",
        user_id=db_user.id,
    )
    db.add(session_row)

    target = new_user_url if (is_register and new_user_url) else callback_url
    response = RedirectResponse(target, status_code=302)
    set_session_cookie(response, session_row.token)
    return response


async def _oauth_callback_d1(
    provider: str, request: Request, backend: D1Backend, fields: dict[str, Any], state: str
) -> RedirectResponse | JSONResponse:
    """D1 counterpart of ``oauth_callback``: same redirects and linking rules."""
    default_error = _default_error_url()
    verification = await auth_d1.consume_verification(backend, state)

    def restart_process() -> RedirectResponse:
        url = f"{default_error}?error=please_restart_the_process"
        return RedirectResponse(url, status_code=302)

    if verification is None:
        return restart_process()
    try:
        state_data = json.loads(str(verification["value"]))
    except Exception:
        return restart_process()
    expires_at = state_data.get("expiresAt")
    if not isinstance(expires_at, int) or expires_at < _now_ms():
        return restart_process()

    error_url = state_data.get("errorURL") or default_error
    new_user_url = state_data.get("newUserURL")
    callback_url = state_data.get("callbackURL")
    code_verifier = state_data.get("codeVerifier")
    if not isinstance(callback_url, str) or not callback_url:
        callback_url = None

    def redirect_on_error(code: str) -> RedirectResponse:
        sep = "&" if "?" in error_url else "?"
        return RedirectResponse(f"{error_url}{sep}error={code}", status_code=302)

    code = fields.get("code")
    if not code:
        return redirect_on_error("no_code")
    if provider not in ("google", "github"):
        return redirect_on_error("oauth_provider_not_found")

    redirect_uri = _provider_redirect_uri(provider)
    try:
        tokens = await _exchange_code(provider, str(code), code_verifier or "", redirect_uri)
    except Exception as exc:
        logger.warning("[auth] token exchange failed for %s: %s", provider, exc)
        return redirect_on_error("invalid_code")

    user_info = await _provider_user(provider, tokens)
    if not user_info:
        return redirect_on_error("unable_to_get_user_info")
    if not user_info.get("email"):
        return redirect_on_error("email_not_found")
    if not callback_url:
        return redirect_on_error("no_callback_url")

    email = str(user_info["email"]).lower()
    account_id = str(user_info["id"])
    now = _now_naive()
    db_user = await auth_d1.find_user_by_email(backend, email)

    is_register = db_user is None
    account_tokens = _account_tokens_payload(tokens)

    if db_user is not None:
        existing_account = await auth_d1.find_account(backend, db_user.id, provider, account_id)
        if existing_account is None:
            if not user_info.get("emailVerified"):
                return redirect_on_error("account_not_linked")
            await auth_d1.link_account(backend, {
                "id": _gen_id(),
                "account_id": account_id,
                "provider_id": provider,
                "user_id": db_user.id,
                "created_at": now,
                "updated_at": now,
                **account_tokens,
            })
        else:
            await auth_d1.touch_account(
                backend, str(existing_account["id"]), {"updated_at": now, **account_tokens}
            )
        user_id = db_user.id
    else:
        user_id = _base_user_id()
        await auth_d1.create_user(backend, {
            "id": user_id,
            "name": (user_info.get("name") or email) or "",
            "email": email,
            "email_verified": bool(user_info.get("emailVerified")),
            "image": user_info.get("image"),
            "created_at": now,
            "updated_at": now,
            "plan": "explore",
            "role": "user",
            "subscription_status": "inactive",
            "trial_interaction_limit": REGULAR_INTERACTION_LIMIT,
            "trial_start_date": now,
            "trial_end_date": now + TRIAL_LIFETIME,
        })
        await auth_d1.link_account(backend, {
            "id": _gen_id(),
            "account_id": account_id,
            "provider_id": provider,
            "user_id": user_id,
            "created_at": now,
            "updated_at": now,
            **account_tokens,
        })
        await _apply_signup_side_effects_d1(backend, user_id, now)

    session_row = await auth_d1.create_session(
        backend,
        user_id=user_id,
        token=_gen_id(32),
        expires_at=(now + SESSION_LIFETIME).isoformat(),
        ip_address=_client_ip(request),
        user_agent=request.headers.get("user-agent") or "",
    )

    target = new_user_url if (is_register and new_user_url) else callback_url
    response = RedirectResponse(target, status_code=302)
    set_session_cookie(response, session_row.token)
    return response


async def _apply_signup_side_effects(db: AsyncSession, user: AuthUser, now: datetime) -> None:
    trial_end = now + TRIAL_LIFETIME
    plan = get_plan("explore")
    try:
        await grant_credits(
            db,
            user_id=user.id,
            amount=plan["includedCredits"],
            source="subscription_cycle",
            source_id=f"signup:{user.id}:explore",
            idempotency_key=f"signup:{user.id}:explore_credits",
            expires_at=trial_end,
            reason="Explore trial credits",
            metadata={"plan": "explore", "trialDays": 30},
        )
    except Exception as exc:
        logger.error("[auth] signup grantCredits failed for %s: %s", user.id, exc)
    try:
        await record_consent_decision(
            db,
            user_id=user.id,
            purposes=list(SIGNUP_DEFAULT_CONSENT_PURPOSES),
            status="granted",
            context=ConsentContext(metadata={"source": "signup_default"}),
        )
    except Exception as exc:
        logger.error("[auth] signup consent seed failed for %s: %s", user.id, exc)


async def _apply_signup_side_effects_d1(backend: D1Backend, user_id: str, now: datetime) -> None:
    trial_end = now + TRIAL_LIFETIME
    plan = get_plan("explore")
    try:
        await billing_d1.grant_credits(
            backend,
            user_id=user_id,
            amount=plan["includedCredits"],
            source="subscription_cycle",
            source_id=f"signup:{user_id}:explore",
            idempotency_key=f"signup:{user_id}:explore_credits",
            expires_at=trial_end.replace(tzinfo=UTC) if trial_end.tzinfo is None else trial_end,
            reason="Explore trial credits",
            metadata={"plan": "explore", "trialDays": 30},
        )
    except Exception as exc:
        logger.error("[auth] signup grantCredits failed for %s: %s", user_id, exc)
    try:
        await auth_d1.record_consent_decision(
            backend,
            user_id=user_id,
            purposes=list(SIGNUP_DEFAULT_CONSENT_PURPOSES),
            status="granted",
            context=ConsentContext(metadata={"source": "signup_default"}),
        )
    except Exception as exc:
        logger.error("[auth] signup consent seed failed for %s: %s", user_id, exc)


@router.post("/telegram-webapp-auth")
async def telegram_webapp_auth(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    """Turn verified Mini App init data into the normal Yomi web session.

    A Telegram identity must already have been linked through ``/start``; the
    endpoint deliberately never creates an account or link from browser input.
    """
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        body = {}
    init_data = body.get("initData") if isinstance(body, dict) else None
    telegram_user_id = _telegram_webapp_user_id(init_data) if isinstance(init_data, str) else None
    if telegram_user_id is None:
        return JSONResponse(
            {"ok": False, "linked": False, "error": "Invalid Telegram session"}, 401
        )

    if d1 is not None:
        from yomi.services import connectors_d1

        user_id = await connectors_d1.resolve_platform_user(
            d1, "telegram", telegram_user_id, telegram_user_id
        )
        if user_id is None:
            return JSONResponse({"ok": True, "linked": False})
        user = await auth_d1.find_user_by_id(d1, user_id)
        if user is None or user.deleted_at is not None:
            return JSONResponse({"ok": True, "linked": False})
        session_row = await auth_d1.create_session(
            d1,
            user_id=user_id,
            token=_gen_id(32),
            expires_at=(datetime.now(UTC) + SESSION_LIFETIME).isoformat(),
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent") or "",
        )
    else:
        user_id = (
            await db.execute(
                select(PlatformConnection.user_id)
                .where(
                    PlatformConnection.platform == "telegram",
                    PlatformConnection.platform_user_id == telegram_user_id,
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if user_id is None:
            return JSONResponse({"ok": True, "linked": False})
        user = (
            await db.execute(select(AuthUser).where(AuthUser.id == user_id).limit(1))
        ).scalar_one_or_none()
        if user is None or user.deleted_at is not None:
            return JSONResponse({"ok": True, "linked": False})
        session_row = AuthSession(
            id=_gen_id(),
            user_id=user.id,
            token=_gen_id(32),
            expires_at=_now_naive() + SESSION_LIFETIME,
            ip_address=_client_ip(request),
            user_agent=request.headers.get("user-agent") or "",
        )
        db.add(session_row)
        await db.flush()

    response = JSONResponse({"ok": True, "linked": True})
    set_session_cookie(response, session_row.token)
    return response


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("cf-connecting-ip")
    if forwarded:
        return forwarded
    return request.client.host if request.client else ""


@router.get("/get-session")
async def get_session(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    if d1 is not None:
        sess, user, cookie_value = await auth_d1.resolve_session(
            d1, read_session_cookie(request), settings.better_auth_secret
        )
        if sess is None:
            response = JSONResponse(None)
            if cookie_value:
                clear_session_cookie(response)
            return response
        if user is None or user.deleted_at is not None:
            await auth_d1.delete_session_by_id(d1, sess.id)
            response = JSONResponse(None)
            clear_session_cookie(response)
            return response
        return JSONResponse({"session": _session_payload(sess), "user": _user_payload(user)})
    sess, user, cookie_value = await _resolve_session(request, db)
    if sess is None:
        response = JSONResponse(None)
        if cookie_value:
            clear_session_cookie(response)
        return response
    if user is None or user.deleted_at is not None:
        await db.execute(delete(AuthSession).where(AuthSession.id == sess.id))
        response = JSONResponse(None)
        clear_session_cookie(response)
        return response
    return JSONResponse({"session": _session_payload(sess), "user": _user_payload(user)})


@router.post("/sign-out")
async def sign_out(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    value = read_session_cookie(request)
    if not value:
        response = JSONResponse(
            {"error": {"message": "failedToGetSession", "status": 400}}, status_code=400
        )
        clear_session_cookie(response)
        return response
    token = recover_token(settings.better_auth_secret, value)
    if token:
        if d1 is not None:
            await auth_d1.delete_session_by_token(d1, token)
        else:
            await db.execute(delete(AuthSession).where(AuthSession.token == token))
    response = JSONResponse({"success": True})
    clear_session_cookie(response)
    return response


@router.post("/revoke-sessions")
async def revoke_sessions(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
) -> JSONResponse:
    if d1 is not None:
        sess, user, _ = await auth_d1.resolve_session(
            d1, read_session_cookie(request), settings.better_auth_secret
        )
        if sess is None or user is None:
            return JSONResponse(
                {"error": {"message": "Unauthorized", "status": 401}}, status_code=401
            )
        await auth_d1.delete_user_sessions(d1, sess.user_id)
        return JSONResponse({"status": True})
    sess, user, _ = await _resolve_session(request, db)
    if sess is None or user is None:
        return JSONResponse({"error": {"message": "Unauthorized", "status": 401}}, status_code=401)
    await db.execute(delete(AuthSession).where(AuthSession.user_id == sess.user_id))
    return JSONResponse({"status": True})
