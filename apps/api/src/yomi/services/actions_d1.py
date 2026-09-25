"""Decide and execute pending actions on D1.

Approving a pending action replays the gated tool in a context *without* the
approval hook (see ``connectors.base.gate_write``), so the real write runs
once, and records the result on the row. Internal (non-connector) actions such
as vault payment authorizations dispatch to their own handlers.

Status flow: pending -> approved -> executed | failed, or pending -> rejected.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from yomi.services import trust_d1, vault_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso

logger = logging.getLogger(__name__)

_RESULT_LIMIT = 4000


class ActionNotFound(LookupError):
    pass


def _payload(row: dict) -> dict[str, Any]:
    payload = row.get("payload")
    if isinstance(payload, str) and payload:
        try:
            payload = json.loads(payload)
        except ValueError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _is_error(result: Any) -> bool:
    return isinstance(result, dict) and bool(result.get("error"))


async def _replay(backend: D1Backend, row: dict) -> Any:
    user_id = str(row["user_id"])
    payload = _payload(row)
    if row["connector"] == "vault" and row["action"] == "vault-authorizePayment":
        return await vault_d1.authorize_payment(backend, user_id, str(payload["payment_id"]))
    if row["connector"] == "trust" and row["action"] == "trust-sendMessage":
        return await trust_d1.send_message(
            backend, user_id, str(payload["recipient_id"]), str(payload.get("body") or ""),
            payload.get("reply_to"),
        )

    from yomi.services.agent.tools import build_user_registry

    # No create_pending_action: gate_write now runs the real call.
    registry = await build_user_registry(None, user_id, None, d1=backend)
    return await registry.execute(str(row["action"]), **payload)


def _source(row: dict) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "sourcePlatform": row.get("source_platform"),
        "sourceChatId": row.get("source_chat_id"),
    }


async def decide(backend: D1Backend, user_id: str, action_id: str, decision: str) -> dict:
    """Approve (and run) or reject one pending action owned by ``user_id``."""
    row = await backend.store.fetch_one(
        "SELECT * FROM pending_actions WHERE id = ? AND user_id = ? "
        "AND status = 'pending' AND expires_at > ? LIMIT 1",
        [action_id, user_id, utcnow_iso()],
    )
    if row is None:
        raise ActionNotFound("Pending action not found or already decided")

    now = utcnow_iso()
    if decision == "reject":
        await backend.store.atomic([
            Statement(
                "UPDATE pending_actions SET status = 'rejected', decided_at = ?, updated_at = ? "
                "WHERE id = ?",
                [now, now, row["id"]],
            )
        ])
        if row["connector"] == "vault":
            payment_id = _payload(row).get("payment_id")
            if payment_id:
                await vault_d1.set_payment_status(
                    backend, user_id, str(payment_id), "rejected", from_status="pending"
                )
        return {"status": "rejected", **_source(row)}

    # Claim the row first so a double-tap can't run the write twice.
    claimed = await backend.store.atomic([
        Statement(
            "UPDATE pending_actions SET status = 'approved', decided_at = ?, updated_at = ? "
            "WHERE id = ? AND status = 'pending' RETURNING id",
            [now, now, row["id"]],
        )
    ])
    if not (claimed and claimed[0].get("results")):
        raise ActionNotFound("Pending action not found or already decided")

    try:
        result = await _replay(backend, row)
        status = "failed" if _is_error(result) else "executed"
    except Exception as exc:  # noqa: BLE001 — the result is shown to the user
        logger.warning("[actions] %s failed: %s", row["action"], exc)
        result = {"error": str(exc)}
        status = "failed"

    encoded = json.dumps(result, default=str)[:_RESULT_LIMIT]
    done = utcnow_iso()
    await backend.store.atomic([
        Statement(
            "UPDATE pending_actions SET status = ?, result = ?, executed_at = ?, updated_at = ? "
            "WHERE id = ?",
            [status, encoded, done, done, row["id"]],
        )
    ])
    return {"status": status, **_source(row), "result": result}


def summarize(outcome: dict) -> str:
    """One chat-friendly line for a decided action."""
    title = outcome.get("title") or "Action"
    if outcome["status"] == "rejected":
        return f"Cancelled: {title}"
    if outcome["status"] == "failed":
        result = outcome.get("result")
        error = result.get("error") if isinstance(result, dict) else result
        return f"Couldn't complete: {title}\n{error}"
    return f"Done: {title}"


async def notify_source(outcome: dict) -> None:
    """Tell the chat that asked for the action how it was decided."""
    if outcome.get("sourcePlatform") != "telegram" or not outcome.get("sourceChatId"):
        return
    from yomi.gateway.telegram import send_message

    try:
        await send_message(str(outcome["sourceChatId"]), summarize(outcome))
    except Exception as exc:  # noqa: BLE001 — notification is best-effort
        logger.warning("[actions] telegram notify failed: %s", exc)
