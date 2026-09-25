"""Best-effort Telegram notifications to a Yomi user by user id (D1)."""

from __future__ import annotations

import logging

from yomi.services.cloudflare_storage.deps import D1Backend

logger = logging.getLogger(__name__)


async def notify_user(backend: D1Backend, user_id: str, text: str) -> bool:
    """Send ``text`` to the user's linked Telegram chat; False when unlinked or failed."""
    row = await backend.store.fetch_one(
        "SELECT platform_chat_id FROM platform_connections WHERE user_id = ? "
        "AND platform = 'telegram' AND platform_chat_id IS NOT NULL LIMIT 1",
        [user_id],
    )
    if not row:
        return False
    from yomi.gateway.telegram import send_message

    try:
        await send_message(str(row["platform_chat_id"]), text)
    except Exception as exc:  # noqa: BLE001 — callers already stored the data
        logger.warning("[notify] telegram send failed: %s", exc)
        return False
    return True
