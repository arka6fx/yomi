"""Transactional email via Resend (free tier: 3,000/month, 100/day).

Off until RESEND_API_KEY is set; EMAIL_FROM must be on a domain verified in
Resend. Sending is best-effort and never raises into the caller.
"""

from __future__ import annotations

import httpx

from yomi.conf import settings
from yomi.logging import get_logger
from yomi.services.http_pool import shared_client

logger = get_logger(__name__)

RESEND_URL = "https://api.resend.com/emails"
# Accounts made through Telegram get a non-deliverable placeholder address.
UNDELIVERABLE_DOMAINS = ("users.getyomi.in",)


def enabled() -> bool:
    return bool(settings.resend_api_key and settings.email_from)


async def send_email(to: str, subject: str, text: str) -> bool:
    if not enabled() or not to or to.rsplit("@", 1)[-1] in UNDELIVERABLE_DOMAINS:
        return False
    try:
        response = await shared_client().post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "text": text,
                **({"reply_to": settings.email_reply_to} if settings.email_reply_to else {}),
            },
            timeout=httpx.Timeout(10.0, connect=4.0),
        )
        response.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — mail must never break the caller
        logger.warning("resend send failed: %s", type(exc).__name__)
        return False


async def send_welcome(to: str, name: str) -> bool:
    first = (name or "").split(" ")[0] if name and "@" not in name else "there"
    return await send_email(
        to,
        "welcome to yomi",
        f"hi {first},\n\n"
        "yomi is set up. here's how to get going:\n\n"
        f"1. link telegram so you can text yomi: {settings.app_url}/dashboard\n"
        "2. connect gmail, calendar or any app you use, from the same page\n"
        "3. text it like a person: \"what's on tomorrow?\", \"remind me at 6\"\n\n"
        "reply to this email if anything's off.\n\n"
        "yomi",
    )
