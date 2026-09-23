"""Privacy data deletion jobs — delete_my_data / delete_account.

Port of apps/api/src/services/privacy/deletion.ts.
"""

from __future__ import annotations

import base64
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import delete, desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.routes.billing import get_dodo_config
from yomi.crypto import decrypt_tokens
from yomi.db.models_app import (
    AgentMessage,
    AgentSession,
    MemoryEmbedding,
    MemoryEntry,
    MemoryRelation,
    RagChunk,
    RagDocument,
    RagEmbedding,
    RagRetrievalLog,
    RagSource,
    Schedule,
    SuggestionDecision,
    UsageEvent,
)
from yomi.db.models_app2 import (
    LinkingCode,
    McpConnection,
    PendingAction,
    PlatformConnection,
    PrivacyDeletionJob,
    TelegramLinkToken,
)
from yomi.db.models_auth import Session, User

GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
REVOCABLE_PROVIDERS = frozenset({"google", "github", "slack", "linear"})


async def revoke_provider_token(
    provider: str, access_token: str
) -> bool:
    """Revoke an OAuth token at the provider (best-effort; returns success)."""
    try:
        if provider == "google":
            res = await httpx.post(
                GOOGLE_REVOKE_URL, params={"token": access_token}, timeout=15.0
            )
            return res.is_success
        if provider == "github":
            client_id = __import__("os").environ.get("GITHUB_INTEGRATIONS_CLIENT_ID")
            client_secret = __import__("os").environ.get("GITHUB_INTEGRATIONS_CLIENT_SECRET")
            if not client_id or not client_secret:
                return False
            creds = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
            res = await httpx.delete(
                f"https://api.github.com/applications/{client_id}/token",
                headers={
                    "Authorization": f"Basic {creds}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json",
                },
                json={"access_token": access_token},
                timeout=15.0,
            )
            return res.status_code == 204
        if provider == "slack":
            res = await httpx.post(
                "https://slack.com/api/auth.revoke",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=15.0,
            )
            if not res.is_success:
                return False
            return (res.json() or {}).get("ok") is True
        if provider == "linear":
            res = await httpx.post(
                "https://api.linear.app/oauth/revoke",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=15.0,
            )
            return res.is_success
    except Exception:
        return False
    # notion and API-key/DSN connectors: no public revocation API — the
    # encrypted credential row is deleted by the mcp_connections step.
    return False


async def revoke_connector_tokens(
    session: AsyncSession, user_id: str
) -> dict[str, list[str]]:
    summary: dict[str, list[str]] = {"attempted": [], "revoked": [], "failed": [], "skipped": []}
    rows = (
        await session.execute(
            select(McpConnection.provider, McpConnection.oauth_tokens).where(
                McpConnection.user_id == user_id
            )
        )
    ).all()
    for provider, oauth_tokens in rows:
        if provider not in REVOCABLE_PROVIDERS:
            summary["skipped"].append(provider)
            continue
        summary["attempted"].append(provider)
        try:
            tokens = decrypt_tokens(oauth_tokens)
            ok = await revoke_provider_token(provider, tokens.access_token)
        except Exception:
            ok = False
        if ok:
            summary["revoked"].append(provider)
        else:
            summary["failed"].append(provider)
    return summary


async def _run_step(
    step: dict[str, Any],
    fn: Callable[[], Awaitable[int]],
) -> tuple[bool, int | None, str | None]:
    """Execute a deletion step; mutate the step dict with outcome metadata.

    Returns (ok, deleted_count, error). The step's status is set by the
    caller on failure so skipped vs failed stays distinguishable.
    """
    step["status"] = "running"
    try:
        count = await fn()
        step["status"] = "done"
        step["deletedCount"] = count
        return True, count, None
    except Exception as err:
        step["status"] = "failed"
        step["error"] = str(err)
        return False, None, str(err)


def _job_dict(row: PrivacyDeletionJob) -> dict[str, Any]:
    return {
        "id": row.id,
        "userId": row.user_id,
        "kind": row.kind,
        "status": row.status,
        "steps": row.steps,
        "error": row.error,
        "requestedAt": row.requested_at,
        "completedAt": row.completed_at,
    }


async def _create_job(
    session: AsyncSession,
    user_id: str,
    kind: str,
    steps: list[dict[str, Any]],
) -> PrivacyDeletionJob | None:
    row = PrivacyDeletionJob(
        user_id=user_id,
        kind=kind,
        status="running",
        steps=steps,
    )
    session.add(row)
    await session.flush()
    return row


async def _update_job(
    session: AsyncSession,
    job: PrivacyDeletionJob,
    steps: list[dict[str, Any]],
    status: str,
    error: str | None = None,
) -> PrivacyDeletionJob | None:
    values: dict[str, Any] = {
        "status": status,
        "steps": steps,
        "completed_at": datetime.now(UTC),
    }
    if error is not None:
        values["error"] = error
    return (
        await session.execute(
            update(PrivacyDeletionJob)
            .where(PrivacyDeletionJob.id == job.id)
            .values(**values)
            .returning(PrivacyDeletionJob)
        )
    ).scalar_one_or_none()


async def _existing_job(
    session: AsyncSession, user_id: str, kind: str
) -> PrivacyDeletionJob | None:
    return (
        await session.execute(
            select(PrivacyDeletionJob)
            .where(
                PrivacyDeletionJob.user_id == user_id,
                PrivacyDeletionJob.kind == kind,
            )
            .order_by(desc(PrivacyDeletionJob.requested_at))
            .limit(1)
        )
    ).scalar_one_or_none()


async def delete_my_data(
    session: AsyncSession, user_id: str
) -> dict[str, Any] | None:
    existing = await _existing_job(session, user_id, "delete_data")
    if existing is not None and existing.status in ("queued", "running"):
        return _job_dict(existing)

    steps: list[dict[str, Any]] = [
        {"name": "revoke_connectors", "status": "pending"},
        {"name": "memory_embeddings", "status": "pending"},
        {"name": "memory_relations", "status": "pending"},
        {"name": "memory_entries", "status": "pending"},
        {"name": "rag_retrieval_logs", "status": "pending"},
        {"name": "rag_embeddings", "status": "pending"},
        {"name": "rag_chunks", "status": "pending"},
        {"name": "rag_documents", "status": "pending"},
        {"name": "rag_sources", "status": "pending"},
        {"name": "mcp_connections", "status": "pending"},
        {"name": "platform_connections", "status": "pending"},
        {"name": "pending_actions", "status": "pending"},
        {"name": "schedules", "status": "pending"},
        {"name": "suggestion_decisions", "status": "pending"},
        {"name": "usage_events", "status": "pending"},
        {"name": "linking_codes", "status": "pending"},
        {"name": "agent_messages", "status": "pending"},
        {"name": "agent_sessions", "status": "pending"},
    ]
    job = await _create_job(session, user_id, "delete_data", steps)
    if job is None:
        return None

    step0 = steps[0]
    summary = await revoke_connector_tokens(session, user_id)
    step0["status"] = "running"
    try:
        step0["status"] = "done"
        step0["deletedCount"] = len(summary["revoked"])
        if summary["failed"]:
            step0["error"] = f"failed: {','.join(summary['failed'])}"
    except Exception as err:
        step0["status"] = "skipped"
        step0["error"] = str(err)

    deletions = [
        (MemoryEmbedding, "memory_embeddings"),
        (MemoryRelation, "memory_relations"),
        (MemoryEntry, "memory_entries"),
        (RagRetrievalLog, "rag_retrieval_logs"),
        (RagEmbedding, "rag_embeddings"),
        (RagChunk, "rag_chunks"),
        (RagDocument, "rag_documents"),
        (RagSource, "rag_sources"),
        (McpConnection, "mcp_connections"),
        (PlatformConnection, "platform_connections"),
        (PendingAction, "pending_actions"),
        (Schedule, "schedules"),
        (SuggestionDecision, "suggestion_decisions"),
        (UsageEvent, "usage_events"),
        (LinkingCode, "linking_codes"),
        (AgentMessage, "agent_messages"),
        (AgentSession, "agent_sessions"),
    ]

    all_ok = True
    for table, name in deletions:
        step = next((s for s in steps if s["name"] == name), None)
        if step is None:
            continue
        async def _delete_one(table=table, name=name) -> int:
            stmt = delete(table).where(table.__table__.c["user_id"] == user_id)
            result = await session.execute(stmt)
            return result.rowcount or 0

        ok, count, error = await _run_step(step, _delete_one)
        if ok:
            step["deletedCount"] = count
        else:
            all_ok = False

    updated = await _update_job(
        session,
        job,
        steps,
        "completed" if all_ok else "completed_with_errors",
        None if all_ok else "One or more deletion steps failed (see steps)",
    )
    return _job_dict(updated) if updated is not None else None


async def get_deletion_job(
    session: AsyncSession, user_id: str, job_id: str
) -> dict[str, Any] | None:
    row = (
        await session.execute(
            select(PrivacyDeletionJob)
            .where(
                PrivacyDeletionJob.id == job_id,
                PrivacyDeletionJob.user_id == user_id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return _job_dict(row) if row is not None else None


async def list_deletion_jobs(session: AsyncSession, user_id: str) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(
                PrivacyDeletionJob.id.label("id"),
                PrivacyDeletionJob.kind.label("kind"),
                PrivacyDeletionJob.status.label("status"),
                PrivacyDeletionJob.steps.label("steps"),
                PrivacyDeletionJob.error.label("error"),
                PrivacyDeletionJob.requested_at.label("requestedAt"),
                PrivacyDeletionJob.completed_at.label("completedAt"),
            )
            .where(
                PrivacyDeletionJob.user_id == user_id,
                PrivacyDeletionJob.kind == "delete_data",
            )
            .order_by(desc(PrivacyDeletionJob.requested_at))
        )
    ).mappings()
    return [dict(row) for row in rows]


async def delete_account(
    session: AsyncSession, user_id: str
) -> dict[str, Any] | None:
    existing = await _existing_job(session, user_id, "delete_account")
    if existing is not None and existing.status in ("queued", "running"):
        return _job_dict(existing)

    steps: list[dict[str, Any]] = [
        {"name": "revoke_connectors", "status": "pending"},
        {"name": "delete_data", "status": "pending"},
        {"name": "cancel_subscription", "status": "pending"},
        {"name": "revoke_sessions", "status": "pending"},
        {"name": "soft_delete_user", "status": "pending"},
    ]
    job = await _create_job(session, user_id, "delete_account", steps)
    if job is None:
        return None

    step0 = steps[0]
    summary = await revoke_connector_tokens(session, user_id)
    step0["status"] = "running"
    try:
        step0["status"] = "done"
        step0["deletedCount"] = len(summary["revoked"])
        if summary["failed"]:
            step0["error"] = f"failed: {','.join(summary['failed'])}"
    except Exception as err:
        step0["status"] = "skipped"
        step0["error"] = str(err)

    step1 = steps[1]
    deletions = [
        MemoryEmbedding,
        MemoryRelation,
        MemoryEntry,
        RagRetrievalLog,
        RagEmbedding,
        RagChunk,
        RagDocument,
        RagSource,
        McpConnection,
        PlatformConnection,
        PendingAction,
        Schedule,
        UsageEvent,
        LinkingCode,
        AgentMessage,
        AgentSession,
        SuggestionDecision,
        TelegramLinkToken,
    ]
    step1["status"] = "running"
    ok = True
    deleted = 0
    first_error: str | None = None
    for table in deletions:
        try:
            result = await session.execute(
                delete(table).where(table.__table__.c["user_id"] == user_id)
            )
            deleted += result.rowcount or 0
        except Exception as err:
            ok = False
            first_error = first_error or str(err)
    step1["status"] = "done" if ok else "failed"
    step1["deletedCount"] = deleted
    if first_error:
        step1["error"] = first_error

    step2 = steps[2]
    try:
        sub_id = (
            await session.execute(
                select(User.dodo_subscription_id).where(User.id == user_id).limit(1)
            )
        ).scalar_one_or_none()
        if sub_id:
            config = get_dodo_config()
            api_key = config.get("api_key")
            if api_key:
                api_base = config.get("api_base", "").rstrip("/")
                await httpx.post(
                    f"{api_base}/subscriptions/{sub_id}/cancel",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    timeout=30.0,
                )
                step2["deletedCount"] = 1
        step2["status"] = "done"
        step2.setdefault("deletedCount", 0)
    except Exception as err:
        step2["status"] = "skipped"
        step2["error"] = str(err)

    step3 = steps[3]
    try:
        result = await session.execute(
            delete(Session).where(Session.user_id == user_id)
        )
        step3["status"] = "done"
        step3["deletedCount"] = result.rowcount or 0
    except Exception as err:
        step3["status"] = "skipped"
        step3["error"] = str(err)

    step4 = steps[4]
    try:
        result = await session.execute(
            update(User)
            .where(User.id == user_id)
            .values(deleted_at=datetime.now(UTC))
        )
        step4["status"] = "done"
        step4["deletedCount"] = result.rowcount or 0
    except Exception as err:
        step4["status"] = "failed"
        step4["error"] = str(err)

    final_status = (
        "completed"
        if all(s["status"] in ("done", "skipped") for s in steps)
        else "completed_with_errors"
    )
    updated = await _update_job(session, job, steps, final_status)
    return _job_dict(updated) if updated is not None else None