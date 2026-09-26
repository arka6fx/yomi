"""Transactional email via Resend (free tier: 3,000/month, 100/day).

Off until RESEND_API_KEY is set; EMAIL_FROM must be on a domain verified in
Resend. Sending is best-effort and never raises into the caller.
"""

from __future__ import annotations

from html import escape

import httpx

from yomi.conf import settings
from yomi.logging import get_logger
from yomi.services.http_pool import shared_client

logger = get_logger(__name__)

RESEND_URL = "https://api.resend.com/emails"
# Accounts made through Telegram get a non-deliverable placeholder address.
UNDELIVERABLE_DOMAINS = ("users.getyomi.in",)
BLUE = "#1e96c8"
INK = "#1d1b18"


def enabled() -> bool:
    return bool(settings.resend_api_key and settings.email_from)


def deliverable(to: str | None) -> bool:
    return bool(to) and "@" in str(to) and str(to).rsplit("@", 1)[-1] not in UNDELIVERABLE_DOMAINS


async def send_email(
    to: str,
    subject: str,
    text: str,
    html: str | None = None,
    unsubscribe_url: str | None = None,
) -> bool:
    if not enabled() or not deliverable(to):
        return False
    headers = (
        {
            "List-Unsubscribe": f"<{unsubscribe_url}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
        if unsubscribe_url
        else None
    )
    try:
        response = await shared_client().post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={
                "from": settings.email_from,
                "to": [to],
                "subject": subject,
                "text": text,
                **({"html": html} if html else {}),
                **({"headers": headers} if headers else {}),
                **({"reply_to": settings.email_reply_to} if settings.email_reply_to else {}),
            },
            timeout=httpx.Timeout(10.0, connect=4.0),
        )
        response.raise_for_status()
        return True
    except Exception as exc:  # noqa: BLE001 — mail must never break the caller
        logger.warning("resend send failed: %s", type(exc).__name__)
        return False


def first_name(name: str | None) -> str:
    name = (name or "").strip()
    if not name or "@" in name:
        return "there"
    return name.split(" ")[0]


def render(
    greeting: str,
    paragraphs: list[str],
    cta: tuple[str, str] | None = None,
    steps: list[str] | None = None,
    footer: str | None = None,
    footer_text: str | None = None,
) -> tuple[str, str]:
    """(text, html) for one short email in Yomi's voice: greeting, copy, one button."""
    text_parts = [greeting, *paragraphs]
    if steps:
        text_parts.append("\n".join(f"{n}. {step}" for n, step in enumerate(steps, 1)))
    if cta:
        text_parts.append(f"{cta[0]}: {cta[1]}")
    text_parts.append("yomi")
    if footer_text or footer:
        text_parts.append(footer_text or footer or "")
    text = "\n\n".join(text_parts)

    p = f'style="margin:0 0 16px;font-size:16px;line-height:1.55;color:{INK}"'
    body = [f"<p {p}>{escape(greeting)}</p>"]
    body += [f"<p {p}>{escape(para)}</p>" for para in paragraphs]
    if steps:
        items = "".join(
            f'<tr><td style="width:28px;vertical-align:top;padding:0 0 12px">'
            f'<span style="display:inline-block;width:22px;height:22px;border-radius:11px;'
            f'background:{BLUE};color:#fff;font-size:12px;font-weight:700;line-height:22px;'
            f'text-align:center">{n}</span></td>'
            f'<td style="padding:1px 0 12px;font-size:15px;line-height:1.5;color:{INK}">'
            f"{escape(step)}</td></tr>"
            for n, step in enumerate(steps, 1)
        )
        body.append(f'<table role="presentation" style="margin:4px 0 12px">{items}</table>')
    if cta:
        body.append(
            f'<p style="margin:8px 0 24px"><a href="{escape(cta[1])}" '
            f'style="display:inline-block;background:{BLUE};color:#fff;text-decoration:none;'
            f'font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">'
            f"{escape(cta[0])}</a></p>"
        )
    body.append(f'<p style="margin:0;font-size:16px;color:{INK}">yomi 🌱</p>')
    foot = (
        f'<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8a8680">'
        f"{footer}</p>"
        if footer
        else ""
    )
    html = (
        '<!doctype html><html><body style="margin:0;background:#eef3f8;'
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,"
        'sans-serif"><table role="presentation" width="100%" style="padding:32px 12px">'
        '<tr><td align="center"><table role="presentation" width="100%" '
        'style="max-width:520px;background:#fff;border-radius:20px;padding:32px 28px">'
        f"<tr><td>{''.join(body)}{foot}</td></tr></table></td></tr></table></body></html>"
    )
    return text, html


async def send_welcome(to: str, name: str) -> bool:
    app = settings.app_url.rstrip("/")
    text, html = render(
        f"hi {first_name(name)},",
        ["you're in. i'm yomi, your assistant that lives in telegram. three things to start:"],
        steps=[
            "open your dashboard and tap “open in telegram”, so i know it's you",
            "connect gmail or calendar there, so i can actually help",
            "text me like a friend: “what's on tomorrow?” or “remind me at 6”",
        ],
        cta=("open my dashboard", f"{app}/dashboard"),
        footer="reply to this email if anything's off. a human reads it.",
    )
    return await send_email(to, "welcome to yomi", text, html)
