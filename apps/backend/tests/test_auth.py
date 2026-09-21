"""Auth port tests: session-cookie primitives, URL builders, and no-DB route paths.

Follows the repo convention of DB-free tests: heavy DB paths (the OAuth
callback) are covered by the wire-format unit tests here; end-to-end login is
verified against production after deploy.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from yomi.app.main import create_app
from yomi.app.routes.auth import (
    ID_CHARACTERS,
    _account_tokens_payload,
    _authorize_url,
    _b64url_sha256,
    _decode_id_token,
    _gen_id,
    _provider_redirect_uri,
    _session_payload,
    _user_payload,
)
from yomi.conf import settings
from yomi.db.models_auth import Session as AuthSession
from yomi.db.models_auth import User as AuthUser
from yomi.db_session import get_db_session
from yomi.services import session_cookie as sc

NOW = datetime(2026, 1, 1, 12, 0, 0)


@pytest.fixture
def no_db_client():
    app = create_app()

    async def _fake_db():
        yield object()

    app.dependency_overrides[get_db_session] = _fake_db
    with TestClient(app) as client:
        yield client


@pytest.fixture
def prod_origins(monkeypatch):
    monkeypatch.setattr(settings, "web_origin", "https://getyomi.in")
    monkeypatch.setattr(settings, "backend_url", "https://api.getyomi.in")
    yield


# --- session-cookie wire format (matches better-auth v1.2.x) ---


def test_sign_and_recover_roundtrip():
    secret = "s3cret"
    raw = _gen_id(32)
    value = sc.sign_token(secret, raw)
    assert value.startswith(raw + ".")
    assert sc.recover_token(secret, value) == raw


def test_recover_legacy_scheme():
    # better-auth <1.1.3: DB stored `<raw>.<hmac({"token": raw})>`, cookie = that value
    secret = "s3cret"
    raw = _gen_id(32)
    sig = sc.hmac_hex(secret, json.dumps({"token": raw}, separators=(",", ":")))
    value = f"{raw}.{sig}"
    assert sc.recover_token(secret, value) == value


def test_recover_rejects_bad_signature():
    secret = "s3cret"
    raw = _gen_id(32)
    value = f"{raw}.90abdef01234567890abdef01234567890abdef01234567890abdef012345678"
    assert sc.recover_token(secret, value) is None


def test_recover_no_secret_returns_raw():
    raw = _gen_id(32)
    assert sc.recover_token("", f"{raw}.ignored") == raw


def test_recover_session_token_accepts_raw_bearer(monkeypatch):
    # The dashboard sends `Authorization: Bearer <session.token>` (the raw DB
    # key, per better-auth). It must be accepted as-is, not only in signed form.
    from yomi.app.deps import _recover_session_token

    monkeypatch.setattr(settings, "better_auth_secret", "s3cret")
    raw = _gen_id(32)
    signed = sc.sign_token("s3cret", raw)
    assert _recover_session_token(raw) == raw
    assert _recover_session_token(signed) == raw
    assert _recover_session_token("") is None


def test_cookie_name_secure_prefix(prod_origins):
    assert sc.use_secure_cookies() is True
    assert sc.session_cookie_name() == "__Secure-yomi.session_token"


def test_cookie_name_plain_on_localhost(monkeypatch):
    monkeypatch.setattr(settings, "web_origin", "http://localhost:3000")
    assert sc.use_secure_cookies() is False
    assert sc.session_cookie_name() == "yomi.session_token"


def test_cookie_domain_split_subdomain(prod_origins):
    assert sc.cookie_domain() == ".getyomi.in"


def test_cookie_domain_none_when_same_host(monkeypatch):
    monkeypatch.setattr(settings, "web_origin", "http://localhost:3000")
    monkeypatch.setattr(settings, "backend_url", "http://localhost:8080")
    assert sc.cookie_domain() is None


def test_cookie_options_http_only_same_site(prod_origins):
    opts = sc.session_cookie_options()
    assert opts["httponly"] is True
    assert opts["samesite"] == "lax"
    assert opts["secure"] is True
    assert opts["domain"] == ".getyomi.in"


# --- token / URL builders ---


def test_gen_id_charset_and_length():
    value = _gen_id(32)
    assert len(value) == 32
    assert all(c in ID_CHARACTERS for c in value)
    assert len(_gen_id(128)) == 128


def test_b64url_sha256_is_stable():
    assert _b64url_sha256("the-verifier") == _b64url_sha256("the-verifier")
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    assert set(_b64url_sha256("x")) <= set(alphabet)


def test_google_authorize_url(prod_origins, monkeypatch):
    monkeypatch.setattr(settings, "google_auth_client_id", "gid")
    url = _authorize_url("google", "state123", "veryverylongcodeverifier")
    assert url.startswith("https://accounts.google.com/o/oauth2/auth?")
    assert "client_id=gid" in url
    assert "state=state123" in url
    assert "scope=email+profile+openid" in url
    assert "code_challenge_method=S256" in url
    assert "code_challenge=" in url
    assert "redirect_uri=https%3A%2F%2Fapi.getyomi.in%2Fapi%2Fauth%2Fcallback%2Fgoogle" in url


def test_github_authorize_url_no_pkce(prod_origins, monkeypatch):
    monkeypatch.setattr(settings, "github_auth_client_id", "ghid")
    url = _authorize_url("github", "state456", "verifier")
    assert url.startswith("https://github.com/login/oauth/authorize?")
    assert "client_id=ghid" in url
    assert "state=state456" in url
    assert "code_challenge" not in url
    assert "redirect_uri=https%3A%2F%2Fgetyomi.in%2Fapi%2Fauth%2Fcallback%2Fgithub" in url


def test_provider_redirect_uris(prod_origins):
    assert _provider_redirect_uri("google") == "https://api.getyomi.in/api/auth/callback/google"
    assert _provider_redirect_uri("github") == "https://getyomi.in/api/auth/callback/github"


def test_decode_id_token_payload():
    header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').rstrip(b"=").decode()
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": "123", "email": "a@b.c", "email_verified": True}).encode()
    ).rstrip(b"=").decode()
    data = _decode_id_token(f"{header}.{payload}.ignoredsig")
    assert data["sub"] == "123"
    assert data["email_verified"] is True


def test_account_tokens_payload_uses_model_columns():
    # regression: keys must map onto Account's snake_case columns (camelCase
    # keys previously made the OAuth callback 500 with an invalid-kwarg error)
    from yomi.db.models_auth import Account

    payload = _account_tokens_payload(
        {
            "accessToken": "at",
            "idToken": "it",
            "refreshToken": "rt",
            "accessTokenExpiresAt": NOW,
            "scopes": ["email", "profile"],
        }
    )
    expected = {
        "access_token",
        "id_token",
        "refresh_token",
        "access_token_expires_at",
        "refresh_token_expires_at",
        "scope",
    }
    assert set(payload) == expected
    for key in payload:
        assert key in Account.__table__.columns, key
    Account(
        id="a",
        account_id="acc",
        provider_id="google",
        user_id="u",
        created_at=NOW,
        updated_at=NOW,
        **payload,
    )


# --- response payload shapes ---


def test_session_payload_shape():
    sess = AuthSession(
        id="s1",
        token="rawtoken",
        user_id="u1",
        expires_at=NOW,
        ip_address="1.2.3.4",
        user_agent="test-agent",
        created_at=NOW,
        updated_at=NOW,
    )
    payload = _session_payload(sess)
    assert payload["id"] == "s1"
    assert payload["userId"] == "u1"
    assert payload["token"] == "rawtoken"
    assert payload["expiresAt"] is not None
    assert payload["createdAt"] is not None


def test_user_payload_shape():
    user = AuthUser(
        id="u1",
        name="Ada",
        email="ada@example.com",
        email_verified=True,
        image="https://img",
        created_at=NOW,
        updated_at=NOW,
        role="user",
        plan="explore",
        subscription_status="inactive",
        trial_start_date=NOW,
        trial_end_date=NOW,
        trial_interaction_limit=100,
        daily_chat_count=0,
        daily_voice_count=0,
        daily_image_count=0,
        agent_usage_count=0,
        daily_reset_date=None,
        deleted_at=None,
        agent_soul=None,
    )
    payload = _user_payload(user)
    assert payload["id"] == "u1"
    assert payload["email"] == "ada@example.com"
    assert payload["emailVerified"] is True
    assert payload["plan"] == "explore"
    assert payload["trialInteractionLimit"] == 100
    assert payload["trialStartDate"] is not None


# --- no-DB route behavior (TestClient with a fake DB dep) ---


def test_get_session_null_without_cookie(no_db_client):
    resp = no_db_client.get("/api/auth/get-session")
    assert resp.status_code == 200
    assert resp.json() is None


def test_sign_out_400_without_cookie(no_db_client):
    resp = no_db_client.post("/api/auth/sign-out")
    assert resp.status_code == 400
    assert resp.json()["error"]["message"] == "failedToGetSession"


def test_sign_in_social_unknown_provider(no_db_client):
    resp = no_db_client.post(
        "/api/auth/sign-in/social/discord", json={"callbackURL": "https://getyomi.in/dashboard"}
    )
    assert resp.status_code == 404


def test_sign_in_social_provider_in_body(no_db_client):
    # the @better-auth/react client POSTs /sign-in/social with provider in the body
    resp = no_db_client.post(
        "/api/auth/sign-in/social",
        json={
            "provider": "discord",
            "callbackURL": "https://getyomi.in/dashboard",
            "errorCallbackURL": "https://getyomi.in/signin",
        },
    )
    assert resp.status_code == 404


def test_callback_missing_state_redirects(no_db_client):
    resp = no_db_client.get("/api/auth/callback/google", follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].endswith("/error?error=state_not_found")