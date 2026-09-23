"""/api/privacy — privacy consent, preferences, export, deletion router.

Port of apps/api/src/routes/privacy.ts.
"""

from __future__ import annotations

import math
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.app.deps import get_current_user, get_db_session
from yomi.db.models_app import (
    AgentMessage,
    AgentSession,
    MemoryEmbedding,
    MemoryEntry,
    MemoryRelation,
    RagChunk,
    RagSource,
    Schedule,
    UsageEvent,
)
from yomi.db.models_app2 import McpConnection, PlatformConnection, PrivacyAuditEvent
from yomi.db.models_auth import User
from yomi.services import auth_d1, privacy_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.privacy.audit import (
    client_ip,
    list_privacy_activity,
    record_privacy_audit_event,
    user_agent,
)
from yomi.services.privacy.consent import (
    get_consent_snapshot,
    list_consent_history,
    record_consent_decision,
    snapshot_to_dict,
)
from yomi.services.privacy.deletion import (
    delete_account,
    delete_my_data,
    get_deletion_job,
    list_deletion_jobs,
)
from yomi.services.privacy.export import get_export, list_exports, request_export
from yomi.services.privacy.preferences import (
    get_privacy_preferences,
    shape_to_dict,
    update_privacy_preferences,
)
from yomi.shared.privacy import (
    PRIVACY_CONSENT_PURPOSES,
    PRIVACY_POLICY_VERSION,
    RETENTION_DEFAULTS,
    TERMS_VERSION,
    is_privacy_consent_purpose,
    is_retention_domain_key,
)

privacy_router = APIRouter(prefix="/api/privacy")

_CAMEL_BOOLEAN_KEYS = {
    "conversationHistoryEnabled": "conversation_history_enabled",
    "memoryEnabled": "memory_enabled",
    "cloudMemoryEnabled": "cloud_memory_enabled",
    "connectorsEnabled": "connectors_enabled",
    "analyticsEnabled": "analytics_enabled",
    "voiceProcessingEnabled": "voice_processing_enabled",
    "aiImprovementEnabled": "ai_improvement_enabled",
    "telegramProcessingEnabled": "telegram_processing_enabled",
}


async def _json_body(request: Request):
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _normalize_purposes(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    purposes: list[str] = []
    for item in value:
        if isinstance(item, str) and is_privacy_consent_purpose(item) and item not in purposes:
            purposes.append(item)
    return purposes


def _consent_context(body: dict[str, Any], request: Request):
    from yomi.services.privacy.consent import ConsentContext as _ConsentContext

    app_version = body.get("appVersion") if isinstance(body.get("appVersion"), str) else None
    return _ConsentContext(
        app_version=app_version,
        ip_address=client_ip(request),
        user_agent=user_agent(request),
        metadata={"source": "dashboard"},
    )


def _audit_kwargs(request: Request, event_type: str, metadata: dict | None = None) -> dict:
    return {
        "event_type": event_type,
        "ip_address": client_ip(request),
        "ua": user_agent(request),
        **({"metadata": metadata} if metadata is not None else {}),
    }


def _bool_patch(body: dict[str, Any]):
    patch: dict[str, Any] = {}
    for camel, snake in _CAMEL_BOOLEAN_KEYS.items():
        if isinstance(body.get(camel), bool):
            patch[snake] = body[camel]
    overrides = body.get("retentionOverrides")
    if isinstance(overrides, dict):
        patch["retention_overrides"] = overrides
    if overrides is None:
        patch["retention_overrides"] = None
    return patch


def _clamp_limit(value: str | None, fallback: int, max_value: int) -> int:
    try:
        n = int(value or "")
    except (TypeError, ValueError):
        return fallback
    if n <= 0:
        return fallback
    return min(n, max_value)


@privacy_router.get("/consents")
async def privacy_consents(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        current = await auth_d1.get_consent_snapshot(d1, user.id)
        history = await auth_d1.list_consent_history(d1, user.id)
    else:
        current = await get_consent_snapshot(db, user.id)
        history = await list_consent_history(db, user.id)
    return {
        "versions": {
            "privacyPolicyVersion": PRIVACY_POLICY_VERSION,
            "termsVersion": TERMS_VERSION,
        },
        "purposes": list(PRIVACY_CONSENT_PURPOSES),
        "consents": [snapshot_to_dict(s) for s in current],
        "history": history,
    }


@privacy_router.post("/consents")
async def privacy_grant_consents(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    purposes = _normalize_purposes(body.get("purposes"))
    if not purposes:
        return JSONResponse(
            {"error": "At least one valid consent purpose is required"}, status_code=400
        )
    if d1 is not None:
        current = await auth_d1.record_consent_decision(
            d1,
            user_id=user.id,
            purposes=purposes,
            status="granted",
            context=_consent_context(body, request),
        )
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.consent.granted", {"purposes": purposes}),
        )
        return {"current": [snapshot_to_dict(s) for s in current]}
    current = await record_consent_decision(
        db,
        user_id=user.id,
        purposes=purposes,
        status="granted",
        context=_consent_context(body, request),
    )
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.consent.granted",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"purposes": purposes},
    )
    await db.flush()
    return {"current": [snapshot_to_dict(s) for s in current]}


@privacy_router.post("/consents/revoke")
async def privacy_revoke_consents(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    purposes = _normalize_purposes(body.get("purposes"))
    if not purposes:
        return JSONResponse(
            {"error": "At least one valid consent purpose is required"}, status_code=400
        )
    if d1 is not None:
        current = await auth_d1.record_consent_decision(
            d1, user_id=user.id, purposes=purposes, status="revoked",
            context=_consent_context(body, request),
        )
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.consent.revoked", {"purposes": purposes}),
        )
        return {"current": [snapshot_to_dict(s) for s in current]}
    current = await record_consent_decision(
        db,
        user_id=user.id,
        purposes=purposes,
        status="revoked",
        context=_consent_context(body, request),
    )
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.consent.revoked",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"purposes": purposes},
    )
    await db.flush()
    return {"current": [snapshot_to_dict(s) for s in current]}


@privacy_router.get("/preferences")
async def privacy_get_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        preferences = await auth_d1.get_privacy_preferences(d1, user.id)
    else:
        preferences = await get_privacy_preferences(db, user.id)
    return {"preferences": shape_to_dict(preferences)}


@privacy_router.patch("/preferences")
async def privacy_patch_preferences(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    patch = _bool_patch(body)
    if not patch:
        return JSONResponse({"error": "No valid privacy preferences provided"}, status_code=400)
    if d1 is not None:
        preferences = await auth_d1.update_privacy_preferences(d1, user.id, patch)
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(
                request, "privacy.preferences.updated", {"changed": list(patch.keys())}
            ),
        )
        return {"preferences": shape_to_dict(preferences)}
    preferences = await update_privacy_preferences(db, user.id, patch)
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.preferences.updated",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"changed": list(patch.keys())},
    )
    await db.flush()
    return {"preferences": shape_to_dict(preferences)}


@privacy_router.get("/overview")
async def privacy_overview(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        preferences = await auth_d1.get_privacy_preferences(d1, user.id)
        current = await auth_d1.get_consent_snapshot(d1, user.id)
        activity = await privacy_d1.list_privacy_activity(d1, user.id, 8)
        counts = await privacy_d1.overview_counts(d1, user.id)
        return {
            "preferences": shape_to_dict(preferences),
            "consents": [snapshot_to_dict(s) for s in current],
            "dataStored": {
                "conversations": {"sessions": counts["sessions"], "messages": counts["messages"]},
                "memories": counts["memories"],
                "rag": {"sources": counts["rag_sources"], "chunks": counts["rag_chunks"]},
                "connectors": counts["connectors"],
                "platforms": counts["platforms"],
                "schedules": counts["schedules"],
                "usageEvents": counts["usage"],
            },
            "recentActivity": activity,
        }
    preferences = await get_privacy_preferences(db, user.id)
    current = await get_consent_snapshot(db, user.id)
    activity = await list_privacy_activity(db, user.id, 8)

    async def _count(model: Any, column: Any) -> int:
        result = await db.execute(select(func.count()).select_from(model).where(column == user.id))
        return int(result.scalar_one())

    sessions = await _count(AgentSession, AgentSession.user_id)
    messages = await _count(AgentMessage, AgentMessage.user_id)
    memories = await _count(MemoryEntry, MemoryEntry.user_id)
    rag_sources = await _count(RagSource, RagSource.user_id)
    rag_chunks = await _count(RagChunk, RagChunk.user_id)
    connectors = await _count(McpConnection, McpConnection.user_id)
    platforms = await _count(PlatformConnection, PlatformConnection.user_id)
    schedules = await _count(Schedule, Schedule.user_id)
    usage = await _count(UsageEvent, UsageEvent.user_id)

    return {
        "preferences": shape_to_dict(preferences),
        "consents": [snapshot_to_dict(s) for s in current],
        "dataStored": {
            "conversations": {"sessions": sessions, "messages": messages},
            "memories": memories,
            "rag": {"sources": rag_sources, "chunks": rag_chunks},
            "connectors": connectors,
            "platforms": platforms,
            "schedules": schedules,
            "usageEvents": usage,
        },
        "recentActivity": activity,
    }


@privacy_router.post("/exports")
async def privacy_create_export(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        result = await privacy_d1.request_export(d1, user.id)
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.export.requested"),
        )
        return {"export": result}
    result = await request_export(db, user.id)
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.export.requested",
        ip_address=client_ip(request),
        ua=user_agent(request),
    )
    await db.flush()
    return {"export": result}


@privacy_router.get("/exports")
async def privacy_list_exports(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return {"exports": await privacy_d1.list_exports(d1, user.id)}
    exports = await list_exports(db, user.id)
    return {"exports": exports}


@privacy_router.get("/exports/{export_id}")
async def privacy_get_export(
    export_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        export_row = await privacy_d1.get_export(d1, user.id, export_id)
    else:
        export_row = await get_export(db, user.id, export_id)
    if export_row is None:
        return JSONResponse({"error": "Export not found"}, status_code=404)
    return {"export": export_row}


@privacy_router.get("/activity")
async def privacy_activity(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    limit = _clamp_limit(request.query_params.get("limit"), 25, 100)
    if d1 is not None:
        return {"activity": await privacy_d1.list_privacy_activity(d1, user.id, limit)}
    rows = (
        await db.execute(
            select(
                PrivacyAuditEvent.id.label("id"),
                PrivacyAuditEvent.event_type.label("eventType"),
                PrivacyAuditEvent.resource_type.label("resourceType"),
                PrivacyAuditEvent.resource_id.label("resourceId"),
                PrivacyAuditEvent.metadata_.label("metadata"),
                PrivacyAuditEvent.created_at.label("createdAt"),
            )
            .where(PrivacyAuditEvent.target_user_id == user.id)
            .order_by(desc(PrivacyAuditEvent.created_at))
            .limit(limit)
        )
    ).mappings()
    return {"activity": [dict(row) for row in rows]}


@privacy_router.get("/retention")
async def privacy_get_retention(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        preferences = await auth_d1.get_privacy_preferences(d1, user.id)
    else:
        preferences = await get_privacy_preferences(db, user.id)
    return {
        "defaults": RETENTION_DEFAULTS,
        "overrides": preferences.retention_overrides or {},
    }


@privacy_router.patch("/retention")
async def privacy_patch_retention(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    body = await _json_body(request)
    overrides_in = body.get("overrides")
    if not isinstance(overrides_in, dict):
        return JSONResponse({"error": "overrides object is required"}, status_code=400)

    overrides: dict[str, int] = {}
    for key, value in overrides_in.items():
        if not is_retention_domain_key(key):
            return JSONResponse({"error": f"Unknown domain: {key}"}, status_code=400)
        policy = RETENTION_DEFAULTS[key]
        if not policy.get("userOverridable"):
            return JSONResponse({"error": f"{key} is not overridable"}, status_code=400)
        days_raw = (
            value
            if isinstance(value, (int, float)) and not isinstance(value, bool)
            else None
        )
        if not isinstance(days_raw, (int, float)) or not math.isfinite(days_raw):
            return JSONResponse(
                {"error": f"{key} must be between 1 and {policy['days']} days"}, status_code=400
            )
        days = math.floor(days_raw)
        # Overrides may only tighten retention, never extend past the default.
        if days < 1 or days > int(policy["days"]):
            return JSONResponse(
                {"error": f"{key} must be between 1 and {policy['days']} days"}, status_code=400
            )
        overrides[key] = days

    if d1 is not None:
        preferences = await auth_d1.update_privacy_preferences(
            d1, user.id, {"retention_overrides": overrides}
        )
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(
                request, "privacy.retention.updated", {"domains": list(overrides.keys())}
            ),
        )
        return {"preferences": shape_to_dict(preferences)}
    preferences = await update_privacy_preferences(
        db, user.id, {"retention_overrides": overrides}
    )
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.retention.updated",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"domains": list(overrides.keys())},
    )
    await db.flush()
    return {"preferences": shape_to_dict(preferences)}


@privacy_router.post("/delete-data")
async def privacy_delete_data(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        job = await privacy_d1.delete_my_data(d1, user.id)
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.delete_data.requested"),
        )
        if job is None:
            return JSONResponse({"error": "Failed to create deletion job"}, status_code=500)
        return {"job": job}
    job = await delete_my_data(db, user.id)
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.delete_data.requested",
        ip_address=client_ip(request),
        ua=user_agent(request),
    )
    await db.flush()
    if job is None:
        return JSONResponse({"error": "Failed to create deletion job"}, status_code=500)
    return {"job": job}


@privacy_router.get("/delete-data")
async def privacy_list_deletion_jobs(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        return {"jobs": await privacy_d1.list_deletion_jobs(d1, user.id)}
    jobs = await list_deletion_jobs(db, user.id)
    return {"jobs": jobs}


@privacy_router.get("/delete-data/{job_id}")
async def privacy_get_deletion_job(
    job_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        job = await privacy_d1.get_deletion_job(d1, user.id, job_id)
    else:
        job = await get_deletion_job(db, user.id, job_id)
    if job is None:
        return JSONResponse({"error": "Deletion job not found"}, status_code=404)
    return {"job": job}


@privacy_router.post("/delete-account")
async def privacy_delete_account(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.delete_account.requested"),
        )
        job = await privacy_d1.delete_account(d1, user.id)
        if job is None:
            return JSONResponse({"error": "Failed to create deletion job"}, status_code=500)
        return {"job": job}
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.delete_account.requested",
        ip_address=client_ip(request),
        ua=user_agent(request),
    )
    job = await delete_account(db, user.id)
    if job is None:
        return JSONResponse({"error": "Failed to create deletion job"}, status_code=500)
    return {"job": job}


@privacy_router.delete("/memories")
async def privacy_delete_memories(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        memories = await d1.store.fetch_all(
            "SELECT id FROM memory_entries WHERE user_id = ?", [user.id]
        )
        now = utcnow_iso()
        statements: list[Statement] = []
        for row in memories:
            statements.append(
                d1.store.insert("vector_sync_outbox", {
                    "id": str(uuid.uuid4()),
                    "user_id": user.id,
                    "kind": "memory",
                    "record_id": str(row["id"]),
                    "revision": "v1",
                    "operation": "delete",
                    "payload": None,
                    "attempts": 0,
                    "last_error": None,
                    "created_at": now,
                    "processed_at": None,
                })
            )
        statements.append(
            Statement("DELETE FROM memory_relations WHERE user_id = ?", [user.id])
        )
        statements.append(
            Statement("DELETE FROM memory_entries WHERE user_id = ? RETURNING id", [user.id])
        )
        results = await d1.store.atomic(statements)
        deleted = len(results[-1].get("results") or [])
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.memories.deleted_all", {"count": deleted}),
        )
        return {"deleted": deleted}
    # memory_sources has no user_id column — it cascades from memory_entries.id
    # (onDelete: "cascade"), same as deletion.ts relies on for that table.
    await db.execute(
        delete(MemoryEmbedding).where(MemoryEmbedding.user_id == user.id)
    )
    await db.execute(delete(MemoryRelation).where(MemoryRelation.user_id == user.id))
    result = await db.execute(
        delete(MemoryEntry)
        .where(MemoryEntry.user_id == user.id)
        .returning(MemoryEntry.id)
    )
    deleted_rows = result.all()
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.memories.deleted_all",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"count": len(deleted_rows)},
    )
    await db.flush()
    return {"deleted": len(deleted_rows)}


@privacy_router.get("/memories/export")
async def privacy_export_memories(
    request: Request,
    db: AsyncSession = Depends(get_db_session),
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if d1 is not None:
        rows = await d1.store.fetch_all(
            "SELECT id, topic, content, created_at FROM memory_entries "
            "WHERE user_id = ? ORDER BY created_at DESC",
            [user.id],
        )
        memories = [
            {
                "id": r["id"], "topic": r["topic"], "content": r["content"],
                "createdAt": r.get("created_at"),
            }
            for r in rows
        ]
        await privacy_d1.record_privacy_audit_event(
            d1, actor_user_id=user.id, target_user_id=user.id,
            **_audit_kwargs(request, "privacy.memories.exported", {"count": len(memories)}),
        )
        return {"memories": memories}
    rows = (
        await db.execute(
            select(
                MemoryEntry.id.label("id"),
                MemoryEntry.topic.label("topic"),
                MemoryEntry.content.label("content"),
                MemoryEntry.created_at.label("createdAt"),
            )
            .where(MemoryEntry.user_id == user.id)
            .order_by(desc(MemoryEntry.created_at))
        )
    ).mappings()
    memories = [dict(row) for row in rows]
    await record_privacy_audit_event(
        db,
        actor_user_id=user.id,
        target_user_id=user.id,
        event_type="privacy.memories.exported",
        ip_address=client_ip(request),
        ua=user_agent(request),
        metadata={"count": len(memories)},
    )
    await db.flush()
    return {"memories": memories}