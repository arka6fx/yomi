"""D1 implementation of privacy audit, export, and deletion jobs.

Mirrors ``services/privacy/audit.py``, ``export.py``, and ``deletion.py``.
Table lists and job shapes are identical to the Postgres versions — this port
changes storage only, not retention policy.

D1-specific behavior:
- memory/rag vectors live in Vectorize (no embedding tables), so every
  deletion path enqueues vector deletes for the user's memory entries and
  rag chunks; the sweeper applies them asynchronously
- batch ``meta.changes`` supplies the deleted-row counts
- datetimes are ISO strings; JSON columns are text
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from yomi.services.auth_d1 import _parse_json_value
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.privacy.audit import AuditMetadata, sanitize_audit_metadata

EXPORT_TTL = timedelta(days=7)


def _changes(result: dict[str, Any]) -> int:
    meta = result.get("meta") or {}
    try:
        return int(meta.get("changes") or 0)
    except (TypeError, ValueError):
        return 0


async def record_privacy_audit_event(
    backend: D1Backend,
    *,
    actor_user_id: str | None = None,
    target_user_id: str | None = None,
    event_type: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    ip_address: str | None = None,
    ua: str | None = None,
    metadata: AuditMetadata | None = None,
) -> None:
    await backend.store.atomic([
        backend.store.insert("privacy_audit_events", {
            "id": str(uuid.uuid4()),
            "actor_user_id": actor_user_id,
            "target_user_id": target_user_id if target_user_id is not None else actor_user_id,
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "ip_address": ip_address,
            "user_agent": ua,
            "metadata": sanitize_audit_metadata(metadata),
            "created_at": utcnow_iso(),
        })
    ])


async def list_privacy_activity(
    backend: D1Backend, user_id: str, limit: int
) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT id, event_type, resource_type, resource_id, metadata, created_at "
        "FROM privacy_audit_events WHERE target_user_id = ? "
        "ORDER BY created_at DESC LIMIT ?",
        [user_id, limit],
    )
    return [
        {
            "id": str(row["id"]),
            "eventType": row["event_type"],
            "resourceType": row.get("resource_type"),
            "resourceId": row.get("resource_id"),
            "metadata": _parse_json_value(row.get("metadata")),
            "createdAt": row.get("created_at"),
        }
        for row in rows
    ]


async def build_manifest(backend: D1Backend, user_id: str) -> dict[str, Any]:
    async def _all(sql: str, params: list[Any], limit: int | None = None) -> list[dict]:
        if limit is not None:
            sql = f"{sql} LIMIT {int(limit)}"
        return await backend.store.fetch_all(sql, params)

    user = await backend.store.fetch_one(
        "SELECT * FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    conversations = await _all(
        "SELECT id, session_id AS sessionId, role, content, created_at AS createdAt "
        "FROM agent_messages WHERE user_id = ? ORDER BY created_at DESC",
        [user_id], 500,
    )
    memories = await _all(
        "SELECT id, kind, topic, summary, content, status, confidence, "
        "created_at AS createdAt FROM memory_entries WHERE user_id = ? "
        "ORDER BY created_at DESC",
        [user_id], 1000,
    )
    rag_sources = await _all(
        "SELECT id, name, source_type AS sourceType, status, created_at AS createdAt "
        "FROM rag_sources WHERE user_id = ?",
        [user_id], 500,
    )
    connectors = await _all(
        "SELECT id, provider, scopes, display_name AS displayName, "
        "created_at AS createdAt FROM mcp_connections WHERE user_id = ?",
        [user_id],
    )
    for row in connectors:
        row["scopes"] = _parse_json_value(row.get("scopes")) or []
    platforms = await _all(
        "SELECT platform, connected_at AS connectedAt FROM platform_connections "
        "WHERE user_id = ?",
        [user_id],
    )
    schedules = await _all(
        "SELECT id, schedule, schedule_type AS scheduleType, prompt, enabled, "
        "created_at AS createdAt FROM schedules WHERE user_id = ?",
        [user_id],
    )
    usage = await _all(
        "SELECT id, kind, cost_cents AS costCents, credits_charged AS creditsCharged, "
        "created_at AS createdAt FROM usage_events WHERE user_id = ? "
        "ORDER BY created_at DESC",
        [user_id], 1000,
    )
    sessions = await _all(
        "SELECT id, created_at AS createdAt FROM session WHERE user_id = ?", [user_id]
    )
    accounts = await _all(
        "SELECT id, provider_id AS providerId, scope FROM account WHERE user_id = ?",
        [user_id],
    )

    profile: dict[str, Any] = {}
    if user is not None:
        profile = {
            "id": user["id"],
            "email": user.get("email"),
            "name": user.get("name"),
            "plan": user.get("plan"),
            "role": user.get("role"),
            "subscriptionStatus": user.get("subscription_status"),
            "createdAt": user.get("created_at"),
            "consentVersion": user.get("consent_version"),
            "consentTimestamp": user.get("consent_timestamp"),
        }
    return {
        "profile": profile,
        "sessions": sessions,
        "accounts": accounts,
        "conversations": conversations,
        "memories": memories,
        "ragSources": rag_sources,
        "connectors": connectors,
        "platforms": platforms,
        "schedules": schedules,
        "usage": usage,
    }


def _export_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "status": row["status"],
        "format": row["format"],
        "manifest": _parse_json_value(row.get("manifest")),
        "archiveUrl": row.get("archive_url"),
        "archiveSha256": row.get("archive_sha256"),
        "error": row.get("error"),
        "requestedAt": row.get("requested_at"),
        "completedAt": row.get("completed_at"),
        "expiresAt": row.get("expires_at"),
    }


async def request_export(
    backend: D1Backend, user_id: str, format: str = "json"
) -> dict[str, Any] | None:
    existing = await backend.store.fetch_one(
        "SELECT * FROM privacy_exports WHERE user_id = ? "
        "ORDER BY requested_at DESC LIMIT 1",
        [user_id],
    )
    if existing is not None and existing.get("status") in ("queued", "processing"):
        return _export_dict(existing)

    now = utcnow_iso()
    new_id = str(uuid.uuid4())
    await backend.store.atomic([
        backend.store.insert("privacy_exports", {
            "id": new_id,
            "user_id": user_id,
            "status": "processing",
            "format": format,
            "manifest": None,
            "archive_url": None,
            "archive_sha256": None,
            "error": None,
            "requested_at": now,
            "completed_at": None,
            "expires_at": None,
        })
    ])
    try:
        manifest = await build_manifest(backend, user_id)
        done = datetime.now(UTC).isoformat()
        await backend.store.atomic([
            Statement(
                "UPDATE privacy_exports SET status = 'completed', manifest = ?, "
                "completed_at = ?, expires_at = ? WHERE id = ?",
                [manifest, done,
                 (datetime.now(UTC) + EXPORT_TTL).isoformat(), new_id],
            )
        ])
    except Exception as err:
        await backend.store.atomic([
            Statement(
                "UPDATE privacy_exports SET status = 'failed', error = ? WHERE id = ?",
                [str(err), new_id],
            )
        ])
    updated = await backend.store.fetch_one(
        "SELECT * FROM privacy_exports WHERE id = ? LIMIT 1", [new_id]
    )
    return _export_dict(updated) if updated is not None else None


async def get_export(
    backend: D1Backend, user_id: str, export_id: str
) -> dict[str, Any] | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM privacy_exports WHERE id = ? LIMIT 1", [export_id]
    )
    if row is None or str(row.get("user_id")) != user_id:
        return None
    return _export_dict(row)


async def list_exports(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT id, status, format, error, requested_at AS requestedAt, "
        "completed_at AS completedAt, expires_at AS expiresAt "
        "FROM privacy_exports WHERE user_id = ? ORDER BY requested_at DESC",
        [user_id],
    )
    return [dict(row) for row in rows]


def _job_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "kind": row["kind"],
        "status": row["status"],
        "steps": _parse_json_value(row.get("steps")) or [],
        "error": row.get("error"),
        "requestedAt": row.get("requested_at"),
        "completedAt": row.get("completed_at"),
    }


async def _create_job(
    backend: D1Backend, user_id: str, kind: str, steps: list[dict[str, Any]]
) -> dict[str, Any]:
    import json as _json

    job_id = str(uuid.uuid4())
    now = utcnow_iso()
    await backend.store.atomic([
        backend.store.insert("privacy_deletion_jobs", {
            "id": job_id,
            "user_id": user_id,
            "kind": kind,
            "status": "running",
            "steps": _json.dumps(steps),
            "error": None,
            "requested_at": now,
            "completed_at": None,
        })
    ])
    return {
        "id": job_id, "user_id": user_id, "kind": kind, "status": "running",
        "steps": steps, "error": None, "requested_at": now, "completed_at": None,
    }


async def _update_job(
    backend: D1Backend,
    job_id: str,
    steps: list[dict[str, Any]],
    status: str,
    error: str | None = None,
) -> dict[str, Any] | None:
    import json as _json

    await backend.store.atomic([
        Statement(
            "UPDATE privacy_deletion_jobs SET status = ?, steps = ?, completed_at = ?, "
            "error = ? WHERE id = ?",
            [status, _json.dumps(steps), utcnow_iso(), error, job_id],
        )
    ])
    return await backend.store.fetch_one(
        "SELECT * FROM privacy_deletion_jobs WHERE id = ? LIMIT 1", [job_id]
    )


async def _existing_job(
    backend: D1Backend, user_id: str, kind: str
) -> dict | None:
    return await backend.store.fetch_one(
        "SELECT * FROM privacy_deletion_jobs WHERE user_id = ? AND kind = ? "
        "ORDER BY requested_at DESC LIMIT 1",
        [user_id, kind],
    )


# Tables owned by two users; a row goes when either side deletes their data.
_PAIR_OWNER_COLUMNS: dict[str, tuple[str, str]] = {
    "trust_links": ("requester_id", "target_id"),
    "trust_messages": ("sender_id", "recipient_id"),
}


async def _delete_where(
    backend: D1Backend, table: str, user_id: str
) -> int:
    if table in _PAIR_OWNER_COLUMNS:
        a, b = _PAIR_OWNER_COLUMNS[table]
        stmt = Statement(f"DELETE FROM {table} WHERE {a} = ? OR {b} = ?", [user_id, user_id])
    else:
        stmt = Statement(f"DELETE FROM {table} WHERE user_id = ?", [user_id])
    results = await backend.store.atomic([stmt])
    return _changes(results[0])


async def _enqueue_vector_deletes_for_user(backend: D1Backend, user_id: str) -> None:
    """Queue Vectorize deletes for every memory entry and rag chunk owned by
    the user. D1 cascades remove the rows; the index needs explicit deletes."""
    now = utcnow_iso()
    memories = await backend.store.fetch_all(
        "SELECT id FROM memory_entries WHERE user_id = ?", [user_id]
    )
    chunks = await backend.store.fetch_all(
        "SELECT id FROM rag_chunks WHERE user_id = ?", [user_id]
    )
    statements: list[Statement] = []
    for row in memories:
        statements.append(backend.store.insert("vector_sync_outbox", {
            "id": str(uuid.uuid4()), "user_id": user_id, "kind": "memory",
            "record_id": str(row["id"]), "revision": "v1", "operation": "delete",
            "payload": None, "attempts": 0, "last_error": None,
            "created_at": now, "processed_at": None,
        }))
    for row in chunks:
        statements.append(backend.store.insert("vector_sync_outbox", {
            "id": str(uuid.uuid4()), "user_id": user_id, "kind": "rag",
            "record_id": str(row["id"]), "revision": "v1", "operation": "delete",
            "payload": None, "attempts": 0, "last_error": None,
            "created_at": now, "processed_at": None,
        }))
    for index in range(0, len(statements), 90):
        await backend.store.atomic(statements[index:index + 90])


async def revoke_connector_tokens(
    backend: D1Backend, user_id: str
) -> dict[str, list[str]]:
    from yomi.crypto import decrypt_tokens
    from yomi.services.privacy.deletion import REVOCABLE_PROVIDERS, revoke_provider_token

    summary: dict[str, list[str]] = {"attempted": [], "revoked": [], "failed": [], "skipped": []}
    rows = await backend.store.fetch_all(
        "SELECT provider, oauth_tokens FROM mcp_connections WHERE user_id = ?", [user_id]
    )
    for row in rows:
        provider = str(row["provider"])
        if provider not in REVOCABLE_PROVIDERS:
            summary["skipped"].append(provider)
            continue
        summary["attempted"].append(provider)
        try:
            tokens = decrypt_tokens(str(row["oauth_tokens"]))
            ok = await revoke_provider_token(provider, tokens.access_token)
        except Exception:
            ok = False
        if ok:
            summary["revoked"].append(provider)
        else:
            summary["failed"].append(provider)
    return summary


_DELETE_DATA_TABLES = (
    "memory_relations",
    "memory_entries",
    "rag_retrieval_logs",
    "rag_chunks",
    "rag_documents",
    "rag_sources",
    "mcp_connections",
    "platform_connections",
    "pending_actions",
    "vault_payments",
    "vault_items",
    "trust_messages",
    "trust_links",
    "trust_settings",
    "schedules",
    "suggestion_decisions",
    "usage_events",
    "linking_codes",
    "agent_messages",
    "agent_sessions",
)

_DELETE_ACCOUNT_TABLES = (
    "memory_relations",
    "memory_entries",
    "rag_retrieval_logs",
    "rag_chunks",
    "rag_documents",
    "rag_sources",
    "mcp_connections",
    "platform_connections",
    "pending_actions",
    "vault_payments",
    "vault_items",
    "trust_messages",
    "trust_links",
    "trust_settings",
    "schedules",
    "usage_events",
    "linking_codes",
    "agent_messages",
    "agent_sessions",
    "suggestion_decisions",
    "telegram_link_tokens",
)


async def delete_my_data(backend: D1Backend, user_id: str) -> dict[str, Any] | None:
    existing = await _existing_job(backend, user_id, "delete_data")
    if existing is not None and existing.get("status") in ("queued", "running"):
        return _job_dict(existing)

    steps: list[dict[str, Any]] = [
        {"name": "revoke_connectors", "status": "pending"},
        *[
            {"name": name, "status": "pending"}
            for name in (
                "memory_entries", "memory_relations",
                "rag_retrieval_logs", "rag_chunks", "rag_documents", "rag_sources",
                "mcp_connections", "platform_connections", "pending_actions",
                "vault_payments", "vault_items", "schedules",
                "suggestion_decisions", "usage_events", "linking_codes",
                "agent_messages", "agent_sessions",
            )
        ],
    ]
    job = await _create_job(backend, user_id, "delete_data", steps)

    step0 = steps[0]
    summary = await revoke_connector_tokens(backend, user_id)
    step0["status"] = "running"
    step0["status"] = "done"
    step0["deletedCount"] = len(summary["revoked"])
    if summary["failed"]:
        step0["error"] = f"failed: {','.join(summary['failed'])}"

    await _enqueue_vector_deletes_for_user(backend, user_id)

    all_ok = True
    for table in _DELETE_DATA_TABLES:
        marker = next((s for s in steps if s["name"] == table), None)
        try:
            count = await _delete_where(backend, table, user_id)
            if marker is not None:
                marker["status"] = "done"
                marker["deletedCount"] = count
        except Exception as err:
            all_ok = False
            if marker is not None:
                marker["status"] = "failed"
                marker["error"] = str(err)
                marker["deletedCount"] = 0

    updated = await _update_job(
        backend, str(job["id"]), steps,
        "completed" if all_ok else "completed_with_errors",
        None if all_ok else "One or more deletion steps failed (see steps)",
    )
    return _job_dict(updated) if updated is not None else None


async def get_deletion_job(
    backend: D1Backend, user_id: str, job_id: str
) -> dict[str, Any] | None:
    row = await backend.store.fetch_one(
        "SELECT * FROM privacy_deletion_jobs WHERE id = ? AND user_id = ? LIMIT 1",
        [job_id, user_id],
    )
    return _job_dict(row) if row is not None else None


async def list_deletion_jobs(backend: D1Backend, user_id: str) -> list[dict[str, Any]]:
    rows = await backend.store.fetch_all(
        "SELECT id, kind, status, steps, error, requested_at AS requestedAt, "
        "completed_at AS completedAt FROM privacy_deletion_jobs "
        "WHERE user_id = ? AND kind = 'delete_data' ORDER BY requested_at DESC",
        [user_id],
    )
    return [dict(row) for row in rows]


async def delete_account(backend: D1Backend, user_id: str) -> dict[str, Any] | None:
    import httpx as _httpx

    from yomi.app.routes.billing import get_dodo_config

    existing = await _existing_job(backend, user_id, "delete_account")
    if existing is not None and existing.get("status") in ("queued", "running"):
        return _job_dict(existing)

    steps: list[dict[str, Any]] = [
        {"name": "revoke_connectors", "status": "pending"},
        {"name": "delete_data", "status": "pending"},
        {"name": "cancel_subscription", "status": "pending"},
        {"name": "revoke_sessions", "status": "pending"},
        {"name": "soft_delete_user", "status": "pending"},
    ]
    job = await _create_job(backend, user_id, "delete_account", steps)

    step0 = steps[0]
    summary = await revoke_connector_tokens(backend, user_id)
    step0["status"] = "running"
    step0["status"] = "done"
    step0["deletedCount"] = len(summary["revoked"])
    if summary["failed"]:
        step0["error"] = f"failed: {','.join(summary['failed'])}"

    await _enqueue_vector_deletes_for_user(backend, user_id)

    step1 = steps[1]
    step1["status"] = "running"
    ok = True
    deleted = 0
    first_error: str | None = None
    for table in _DELETE_ACCOUNT_TABLES:
        try:
            deleted += await _delete_where(backend, table, user_id)
        except Exception as err:
            ok = False
            first_error = first_error or str(err)
    step1["status"] = "done" if ok else "failed"
    step1["deletedCount"] = deleted
    if first_error:
        step1["error"] = first_error

    step2 = steps[2]
    try:
        sub = await backend.store.fetch_one(
            "SELECT dodo_subscription_id FROM user WHERE id = ? LIMIT 1", [user_id]
        )
        sub_id = (sub or {}).get("dodo_subscription_id")
        if sub_id:
            config = get_dodo_config()
            api_key = config.get("api_key")
            if api_key:
                api_base = (config.get("api_base") or "").rstrip("/")
                await _httpx.post(
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
        results = await backend.store.atomic([
            Statement("DELETE FROM session WHERE user_id = ? RETURNING id", [user_id])
        ])
        step3["status"] = "done"
        step3["deletedCount"] = len(results[0].get("results") or [])
    except Exception as err:
        step3["status"] = "skipped"
        step3["error"] = str(err)

    step4 = steps[4]
    try:
        results = await backend.store.atomic([
            Statement(
                "UPDATE user SET deleted_at = ? WHERE id = ? RETURNING id",
                [utcnow_iso(), user_id],
            )
        ])
        step4["status"] = "done"
        step4["deletedCount"] = len(results[0].get("results") or [])
    except Exception as err:
        step4["status"] = "failed"
        step4["error"] = str(err)

    final_status = (
        "completed"
        if all(s["status"] in ("done", "skipped") for s in steps)
        else "completed_with_errors"
    )
    updated = await _update_job(backend, str(job["id"]), steps, final_status)
    return _job_dict(updated) if updated is not None else None


async def overview_counts(backend: D1Backend, user_id: str) -> dict[str, int]:
    tables = (
        ("agent_sessions", "sessions"),
        ("agent_messages", "messages"),
        ("memory_entries", "memories"),
        ("rag_sources", "rag_sources"),
        ("rag_chunks", "rag_chunks"),
        ("mcp_connections", "connectors"),
        ("platform_connections", "platforms"),
        ("schedules", "schedules"),
        ("usage_events", "usage"),
    )
    counts: dict[str, int] = {}
    for table, key in tables:
        rows = await backend.store.fetch_all(
            f"SELECT COUNT(*) AS n FROM {table} WHERE user_id = ?", [user_id]
        )
        counts[key] = int(rows[0]["n"])
    return counts
