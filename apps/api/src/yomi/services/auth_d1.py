"""D1 implementation of auth sessions, users, verification, accounts, and consent.

Mirrors ``app/routes/auth.py`` storage paths, ``app/deps.py`` user loading,
and the privacy consent/preference reads those routes depend on.

Routes keep attribute access (``user.id``, ``user.plan`` …) because D1 rows
are materialized into transient ``User``/``Session`` ORM instances — never
added to a SQLAlchemy session, only read. Datetimes are parsed to aware
datetimes and boolean columns are coerced to ``bool`` so JSON output matches
the Postgres path exactly.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from yomi.db.models_auth import Session as AuthSession
from yomi.db.models_auth import User as AuthUser
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt, utcnow_iso
from yomi.services.privacy.checks import PURPOSE_TO_PREFERENCE_KEY, ConsentCheckResult
from yomi.services.privacy.consent import (
    PURPOSE_TO_PREFERENCE,
    ConsentContext,
    ConsentSnapshot,
)
from yomi.services.privacy.preferences import (
    BOOLEAN_PREFERENCE_KEYS,
    DEFAULT_PREFERENCES,
    PrivacyPreferencesShape,
    invalidate_privacy_read_cache,
    memo_privacy_read,
)
from yomi.services.session_cookie import recover_token
from yomi.shared.privacy import (
    CONSENT_VERSION,
    PRIVACY_CONSENT_PURPOSES,
    PRIVACY_POLICY_VERSION,
    TERMS_VERSION,
)

_USER_BOOLS = ("email_verified", "leaderboard_opt_in", "leaderboard_show_photo")


def _parse_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except ValueError:
            return None
    return None


_USER_COLUMNS = frozenset(AuthUser.__table__.columns.keys())


def _user_from_row(row: dict[str, Any]) -> AuthUser:
    # D1-only columns (e.g. bio) aren't on the shared model; read them from the row.
    data = {key: value for key, value in row.items() if key in _USER_COLUMNS}
    for key in _USER_BOOLS:
        if key in data:
            data[key] = bool(data[key])
    for key in (
        "created_at", "updated_at", "trial_start_date", "trial_end_date",
        "current_period_end", "consent_timestamp", "last_export_at", "deleted_at",
    ):
        if key in data:
            data[key] = parse_dt(data[key])
    data["privacy_preferences"] = _parse_json_value(data.get("privacy_preferences")) or {}
    data["pending_connector_nudge"] = _parse_json_value(data.get("pending_connector_nudge"))
    return AuthUser(**data)


def _session_from_row(row: dict[str, Any]) -> AuthSession:
    data = dict(row)
    for key in ("created_at", "updated_at", "expires_at"):
        if key in data:
            data[key] = parse_dt(data[key])
    return AuthSession(**data)


async def load_request_user(backend: D1Backend, lookup: str, request: Any = None) -> AuthUser:
    """D1 counterpart of ``deps.get_current_user``: same 401 cases."""
    from fastapi import HTTPException, status  # noqa: PLC0415 — keeps web layer out of imports

    sess = await find_session_by_token(backend, lookup)
    if sess is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session not found")
    expires = sess.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired")
    user = await find_user_by_id(backend, sess.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if request is not None:
        request.state.user = user
    return user


async def find_user_by_id(backend: D1Backend, user_id: str) -> AuthUser | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    return _user_from_row(row) if row else None


async def find_user_by_email(backend: D1Backend, email: str) -> AuthUser | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM user WHERE email = ? LIMIT 1", [email]
    )
    return _user_from_row(row) if row else None


async def create_user(backend: D1Backend, values: dict[str, Any]) -> AuthUser:
    now = utcnow_iso()
    row = {
        "id": values["id"],
        "name": values.get("name") or "",
        "email": values["email"],
        "email_verified": 1 if values.get("email_verified") else 0,
        "image": values.get("image"),
        "created_at": values.get("created_at") or now,
        "updated_at": values.get("updated_at") or now,
        "role": values.get("role") or "user",
        "plan": values.get("plan") or "explore",
        "subscription_status": values.get("subscription_status") or "inactive",
        "trial_start_date": values.get("trial_start_date"),
        "trial_end_date": values.get("trial_end_date"),
        "trial_interaction_limit": values.get("trial_interaction_limit", 100),
        "trial_interaction_used": 0,
        "daily_chat_count": 0,
        "daily_voice_count": 0,
        "daily_image_count": 0,
        "agent_usage_count": 0,
        "soul_onboarding": "unprompted",
        "current_streak": 0,
        "longest_streak": 0,
        "total_messages_sent": 0,
        "leaderboard_opt_in": 1,
        "leaderboard_show_photo": 1,
        "privacy_preferences": {},
        "export_count": 0,
    }
    await backend.store.atomic([backend.store.insert("user", row)])
    created = await find_user_by_id(backend, values["id"])
    assert created is not None
    return created


async def find_session_by_token(backend: D1Backend, token: str) -> AuthSession | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM session WHERE token = ? LIMIT 1", [token]
    )
    return _session_from_row(row) if row else None


async def create_session(
    backend: D1Backend,
    *,
    user_id: str,
    token: str,
    expires_at: str,
    ip_address: str = "",
    user_agent: str = "",
) -> AuthSession:
    now = utcnow_iso()
    session_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert("session", {
            "id": session_id,
            "expires_at": expires_at,
            "token": token,
            "created_at": now,
            "updated_at": now,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "user_id": user_id,
        })
    ])
    row = await backend.store.fetch_one(
        "SELECT * FROM session WHERE id = ? LIMIT 1", [session_id]
    )
    assert row is not None
    return _session_from_row(row)


async def delete_session_by_token(backend: D1Backend, token: str) -> None:
    await backend.store.atomic([
        Statement("DELETE FROM session WHERE token = ?", [token])
    ])


async def delete_session_by_id(backend: D1Backend, session_id: str) -> None:
    await backend.store.atomic([
        Statement("DELETE FROM session WHERE id = ?", [session_id])
    ])


async def delete_user_sessions(backend: D1Backend, user_id: str) -> None:
    await backend.store.atomic([
        Statement("DELETE FROM session WHERE user_id = ?", [user_id])
    ])


async def resolve_session(
    backend: D1Backend, cookie_value: str | None, secret: str
) -> tuple[AuthSession | None, AuthUser | None, str | None]:
    """D1 counterpart of ``auth._resolve_session`` (dict-free: transient rows)."""
    if not cookie_value:
        return None, None, None
    token = recover_token(secret, cookie_value)
    if not token:
        return None, None, cookie_value
    sess = await find_session_by_token(backend, token)
    if not sess:
        return None, None, cookie_value
    expires = sess.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires < datetime.now(UTC):
        await delete_session_by_id(backend, sess.id)
        return None, None, cookie_value
    user = await find_user_by_id(backend, sess.user_id)
    return sess, user, cookie_value


async def create_verification(
    backend: D1Backend,
    *,
    identifier: str,
    value: str,
    expires_at: str,
    now: str,
) -> None:
    await backend.store.atomic([
        backend.store.insert("verification", {
            "id": str(uuid.uuid4()),
            "identifier": identifier,
            "value": value,
            "expires_at": expires_at,
            "created_at": now,
            "updated_at": now,
        })
    ])


async def consume_verification(
    backend: D1Backend, identifier: str
) -> dict[str, Any] | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM verification WHERE identifier = ? LIMIT 1", [identifier]
    )
    if row is None:
        return None
    await backend.store.atomic([
        Statement("DELETE FROM verification WHERE identifier = ?", [identifier])
    ])
    return row


async def find_account(
    backend: D1Backend, user_id: str, provider: str, account_id: str
) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM account WHERE user_id = ? AND provider_id = ? AND account_id = ? "
        "LIMIT 1",
        [user_id, provider, account_id],
    )


async def link_account(backend: D1Backend, values: dict[str, Any]) -> None:
    await backend.store.atomic([backend.store.insert("account", values)])


async def touch_account(backend: D1Backend, account_id: str, values: dict[str, Any]) -> None:
    from yomi.services.cloudflare_storage.store import encode as _encode

    encoded = {key: _encode(value) for key, value in values.items()}
    assignments = ", ".join(f"{key} = ?" for key in encoded)
    await backend.store.atomic([
        Statement(
            f"UPDATE account SET {assignments} WHERE id = ?",
            [*encoded.values(), account_id],
        )
    ])


async def get_privacy_preferences(
    backend: D1Backend, user_id: str
) -> PrivacyPreferencesShape:
    async def _load() -> PrivacyPreferencesShape:
        row = await backend.store.fetch_one(
            "SELECT * FROM privacy_preferences WHERE user_id = ? LIMIT 1", [user_id]
        )
        if row is None:
            return DEFAULT_PREFERENCES
        return PrivacyPreferencesShape(
            **{key: bool(row.get(key)) for key in BOOLEAN_PREFERENCE_KEYS},
            retention_overrides=_parse_json_value(row.get("retention_overrides")),
            updated_at=parse_dt(row.get("updated_at")),
        )

    return await memo_privacy_read(f"prefs:{user_id}", _load)


async def update_privacy_preferences(
    backend: D1Backend, user_id: str, patch: dict[str, Any]
) -> PrivacyPreferencesShape:
    invalidate_privacy_read_cache(user_id)
    now = utcnow_iso()
    existing = await backend.store.fetch_one(
        "SELECT * FROM privacy_preferences WHERE user_id = ? LIMIT 1", [user_id]
    )
    if existing is None:
        row = {"user_id": user_id, "updated_at": now}
        for key in BOOLEAN_PREFERENCE_KEYS:
            row[key] = 1 if patch.get(key) is True else 0
        if "retention_overrides" in patch:
            row["retention_overrides"] = patch["retention_overrides"]
        await backend.store.atomic([backend.store.insert("privacy_preferences", row)])
    else:
        from yomi.services.cloudflare_storage.store import encode as _encode

        assignments = ", ".join(
            ["updated_at = ?"] + [f"{key} = ?" for key in patch if key != "updated_at"]
        )
        params: list[Any] = [now]
        for key, value in patch.items():
            if key == "updated_at":
                continue
            params.append(_encode(value))
        params.append(user_id)
        await backend.store.atomic([
            Statement(
                f"UPDATE privacy_preferences SET {assignments} WHERE user_id = ?",
                params,
            )
        ])
    result = await get_privacy_preferences(backend, user_id)
    return result


def _consent_row_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "purpose": row["purpose"],
        "status": row["status"],
        "consentVersion": row["consent_version"],
        "privacyPolicyVersion": row["privacy_policy_version"],
        "termsVersion": row["terms_version"],
        "appVersion": row.get("app_version"),
        "createdAt": parse_dt(row.get("created_at")),
    }


async def list_consent_history(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT * FROM privacy_consents WHERE user_id = ? ORDER BY created_at DESC",
        [user_id],
    )
    return [_consent_row_dict(row) for row in rows]


async def get_consent_snapshot(backend: D1Backend, user_id: str) -> list[ConsentSnapshot]:
    async def _load() -> list[ConsentSnapshot]:
        history = await list_consent_history(backend, user_id)
        latest: dict[str, ConsentSnapshot] = {}
        for entry in history:
            if entry["purpose"] in latest:
                continue
            latest[entry["purpose"]] = ConsentSnapshot(
                purpose=entry["purpose"],
                status=entry["status"],
                consent_version=entry["consentVersion"],
                privacy_policy_version=entry["privacyPolicyVersion"],
                terms_version=entry["termsVersion"],
                app_version=entry["appVersion"],
                created_at=entry["createdAt"],
            )
        return list(latest.values())

    return await memo_privacy_read(f"consents:{user_id}", _load)


async def record_consent_decision(
    backend: D1Backend,
    *,
    user_id: str,
    purposes: list[str],
    status: str,
    context: ConsentContext,
) -> list[ConsentSnapshot]:
    if not purposes:
        return await get_consent_snapshot(backend, user_id)
    invalidate_privacy_read_cache(user_id)
    now = utcnow_iso()
    statements = [
        backend.store.insert("privacy_consents", {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "purpose": purpose,
            "status": status,
            "consent_version": CONSENT_VERSION,
            "privacy_policy_version": PRIVACY_POLICY_VERSION,
            "terms_version": TERMS_VERSION,
            "app_version": context.app_version,
            "ip_address": context.ip_address,
            "user_agent": context.user_agent,
            "metadata": (context.metadata or None),
            "created_at": now,
        })
        for purpose in purposes
    ]
    await backend.store.atomic(statements)
    preference_patch = {
        key: status == "granted"
        for purpose in purposes
        if (key := PURPOSE_TO_PREFERENCE.get(purpose))
    }
    if preference_patch:
        await update_privacy_preferences(backend, user_id, preference_patch)
    if status == "granted":
        await backend.store.atomic([
            Statement(
                "UPDATE user SET consent_version = ?, consent_timestamp = ?, "
                "privacy_policy_version = ?, terms_version = ? WHERE id = ?",
                [CONSENT_VERSION, now, PRIVACY_POLICY_VERSION, TERMS_VERSION, user_id],
            )
        ])
    return await get_consent_snapshot(backend, user_id)


async def check_consent(
    backend: D1Backend, user_id: str, purpose: str
) -> ConsentCheckResult:
    if purpose not in PRIVACY_CONSENT_PURPOSES:
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} is not a valid purpose", decided=True
        )
    preferences = await get_privacy_preferences(backend, user_id)
    consents = await get_consent_snapshot(backend, user_id)
    consent = next((c for c in consents if c.purpose == purpose), None)
    decided = consent is not None
    pref_key = PURPOSE_TO_PREFERENCE_KEY.get(purpose)
    if pref_key and not getattr(preferences, pref_key):
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} preference is disabled", decided=decided
        )
    if consent is None or consent.status != "granted":
        return ConsentCheckResult(
            allowed=False, reason=f"{purpose} consent has not been granted", decided=decided
        )
    return ConsentCheckResult(allowed=True, reason=None, decided=decided)


async def grant_consent_if_undecided(
    backend: D1Backend,
    user_id: str,
    purposes: list[str],
    source: str,
) -> None:
    undecided: list[str] = []
    for purpose in purposes:
        result = await check_consent(backend, user_id, purpose)
        if not result.decided:
            undecided.append(purpose)
    if not undecided:
        return
    await record_consent_decision(
        backend,
        user_id=user_id,
        purposes=undecided,
        status="granted",
        context=ConsentContext(metadata={"source": source}),
    )


async def update_user_fields(
    backend: D1Backend, user_id: str, values: dict[str, Any]
) -> dict | None:
    """Patch user columns; returns the refreshed row. Datetimes serialize to ISO."""
    from yomi.services.cloudflare_storage.store import encode as _encode

    encoded = {key: _encode(value) for key, value in values.items()}
    encoded["updated_at"] = utcnow_iso()
    assignments = ", ".join(f"{key} = ?" for key in encoded)
    await backend.store.atomic([
        Statement(
            f"UPDATE user SET {assignments} WHERE id = ?",
            [*encoded.values(), user_id],
        )
    ])
    return await backend.store.fetch_one(
        "SELECT * FROM user WHERE id = ? LIMIT 1", [user_id]
    )
