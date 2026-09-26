"""Fold a Telegram-only placeholder account into the account Telegram is being linked to.

Signing in with Telegram creates an account with a placeholder email. When that person
later links the same Telegram from their Google/GitHub account, the chat moves over, so
their memories, routines, vault and characters move with it and the empty shell goes.

Only placeholder accounts are ever merged: no OAuth login and no payments. Free signup
credits and usage history stay behind, so merging can't be used to farm credits.
"""

from __future__ import annotations

import logging
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import new_id, utcnow_iso

logger = logging.getLogger(__name__)

PLACEHOLDER_EMAIL = "telegram-%@users.getyomi.in"

# Rows that follow the person. UPDATE OR IGNORE keeps the target's row whenever both
# accounts hold the same unique key (e.g. both already have an email alias).
MOVE_TABLES = (
    "memory_entries",
    "memory_relations",
    "rag_sources",
    "rag_documents",
    "rag_chunks",
    "agent_sessions",
    "agent_messages",
    "agent_runs",
    "composio_connections",
    "custom_mcp_servers",
    "mcp_connections",
    "pending_actions",
    "schedules",
    "vault_items",
    "vault_payments",
    "inbound_emails",
    "expenses",
    "email_aliases",
    "trust_settings",
    "characters",
    "character_saves",
    "character_settings",
    "character_chats",
    "character_likes",
    "active_characters",
    "generated_suggestions",
    "suggestion_decisions",
    "devices",
)
MOVE_PAIRS = {
    "trust_links": ("requester_id", "target_id"),
    "trust_messages": ("sender_id", "recipient_id"),
}
# What stays with the placeholder and is deleted with it. Tables whose foreign key
# cascades from "user" go with the user row; these either don't cascade or have none.
DROP_TABLES = (
    *MOVE_TABLES,
    "rag_retrieval_logs",
    "usage_events",
    "ai_usage_events",
    "credit_transactions",
    "credit_grants",
    "credit_accounts",
    "linking_codes",
    "telegram_link_tokens",
    "telegram_login_requests",
    "telegram_miniapp_login_tokens",
    "privacy_consents",
    "privacy_preferences",
    "privacy_exports",
    "privacy_deletion_jobs",
    "session",
)
MAX_REEMBED = 200


async def is_placeholder(backend: D1Backend, user_id: str) -> bool:
    row = await backend.store.fetch_one(
        "SELECT u.id FROM \"user\" u WHERE u.id = ? AND u.email LIKE ? "
        "AND NOT EXISTS (SELECT 1 FROM account a WHERE a.user_id = u.id) "
        "AND NOT EXISTS (SELECT 1 FROM payment_records p WHERE p.user_id = u.id) "
        "AND COALESCE(u.subscription_status, 'inactive') NOT IN ('active', 'on_hold') "
        "LIMIT 1",
        [user_id, PLACEHOLDER_EMAIL],
    )
    return row is not None


async def merge_placeholder(backend: D1Backend, source: str, target: str) -> bool:
    """Move ``source``'s data into ``target`` and delete ``source``. False if not allowed."""
    if source == target or not await is_placeholder(backend, source):
        return False
    moves = [
        Statement(f"UPDATE OR IGNORE {table} SET user_id = ? WHERE user_id = ?", [target, source])
        for table in MOVE_TABLES
    ]
    for table, cols in MOVE_PAIRS.items():
        for col in cols:
            moves.append(Statement(
                f"UPDATE OR IGNORE {table} SET {col} = ? WHERE {col} = ?", [target, source]
            ))
    await backend.store.atomic(moves)

    drops = [Statement(f"DELETE FROM {t} WHERE user_id = ?", [source]) for t in DROP_TABLES]
    for table, cols in MOVE_PAIRS.items():
        drops.append(Statement(
            f"DELETE FROM {table} WHERE {cols[0]} = ? OR {cols[1]} = ?", [source, source]
        ))
    drops.append(Statement("DELETE FROM referral_events WHERE referred_user_id = ? "
                           "OR referrer_user_id = ?", [source, source]))
    drops.append(Statement("DELETE FROM platform_connections WHERE user_id = ?", [source]))
    drops.append(Statement('DELETE FROM "user" WHERE id = ?', [source]))
    await backend.store.atomic(drops)
    logger.info("merged placeholder account %s into %s", source, target)
    await _reembed_memories(backend, target)
    return True


async def _reembed_memories(backend: D1Backend, user_id: str) -> None:
    """Vectors carry their owner; re-upsert moved memories so search finds them."""
    from yomi.services.memory.embeddings import embed_memory_text

    rows = await backend.store.fetch_all(
        "SELECT id, kind, topic, summary, content FROM memory_entries WHERE user_id = ? "
        "AND status = 'active' AND is_latest = 1 ORDER BY updated_at DESC LIMIT ?",
        [user_id, MAX_REEMBED],
    )
    revision = f"merge-{utcnow_iso()}"
    statements: list[Statement] = []
    for row in rows:
        try:
            values = await embed_memory_text(
                f"{row['kind']}: {row['topic']}\n{row['summary'] or ''}\n{row['content']}"
            )
        except Exception:
            logger.debug("re-embed failed for memory %s", row["id"], exc_info=True)
            continue
        if not values:
            continue
        statements.append(_outbox(backend, user_id, str(row["id"]), revision, values))
    if statements:
        await backend.store.atomic(statements)


def _outbox(
    backend: D1Backend, user_id: str, record_id: str, revision: str, values: list[Any]
) -> Statement:
    return backend.store.insert("vector_sync_outbox", {
        "id": new_id(),
        "user_id": user_id,
        "kind": "memory",
        "record_id": record_id,
        "revision": revision,
        "operation": "upsert",
        "payload": {"values": [float(v) for v in values]},
        "attempts": 0,
        "last_error": None,
        "created_at": utcnow_iso(),
        "processed_at": None,
    })
