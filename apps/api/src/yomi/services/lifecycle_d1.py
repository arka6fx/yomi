"""Onboarding and win-back nudges, sent once each over Telegram or email.

New accounts get up to three short nudges in their first weeks, each only if it
still applies: connect an app (day 1), try a routine (day 3), and come back
(day 7, only after five quiet days). Telegram is preferred because that's where
people talk to Yomi; email is the fallback for accounts without it. At most one
nudge a day, only between 10:00 and 20:00 in the user's time zone, and never
again after /stoptips or the email's unsubscribe link.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from yomi.conf import settings
from yomi.logging import get_logger
from yomi.services import mail
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt

logger = get_logger(__name__)

WINDOW = timedelta(days=45)  # only accounts this young are nudged
GAP = timedelta(hours=20)  # at least this long between two nudges
QUIET = timedelta(days=5)  # "come back" only after this long without a message
BATCH = 40
DEFAULT_TZ = "Asia/Kolkata"
OPTED_OUT = "opted_out"
SKIPPED = "skipped"
STOP_HINT = "\n\n(send /stoptips and i'll stop these)"


@dataclass(frozen=True)
class Nudge:
    step: str
    after: timedelta
    telegram: str
    subject: str
    email: list[str]
    cta: str
    path: str


NUDGES = (
    Nudge(
        "connect_apps",
        timedelta(days=1),
        "quick tip 💡 i get a lot more useful once i can see your stuff. connect Gmail or "
        "Calendar, then ask me \"what's on today?\"\n\n{app}/dashboard?tab=integrations",
        "yomi works better with your apps",
        [
            "i get a lot more useful once i can see your stuff.",
            "connect Gmail or Calendar, then ask me “what's on today?” or “anything urgent "
            "in my inbox?”. i always ask before sending or changing anything.",
        ],
        "connect an app",
        "/dashboard?tab=integrations",
    ),
    Nudge(
        "try_routine",
        timedelta(days=3),
        "want something done on repeat? just tell me, like \"every morning at 8, send me my "
        "day\" or \"every friday, remind me to send the invoice\". free includes 3 routines.",
        "let yomi handle the repeat stuff",
        [
            "want something done on repeat? just tell me.",
            "“every morning at 8, send me my day” or “every friday, remind me to send the "
            "invoice”. free includes 3 routines.",
        ],
        "see my routines",
        "/dashboard?tab=schedules",
    ),
    Nudge(
        "come_back",
        timedelta(days=7),
        "haven't heard from you in a bit 👀 anything i can take off your plate? try \"what did "
        "i miss in my inbox?\" or just send a voice note.",
        "anything i can take off your plate?",
        [
            "haven't heard from you in a bit 👀",
            "try “what did i miss in my inbox?”, “plan my week”, or just send a voice note.",
        ],
        "text yomi",
        "",
    ),
)
STEPS = {nudge.step for nudge in NUDGES}


def _secret() -> bytes:
    return (settings.better_auth_secret or settings.internal_api_key).encode()


def unsubscribe_token(user_id: str) -> str:
    return hmac.new(_secret(), f"unsub:{user_id}".encode(), hashlib.sha256).hexdigest()[:32]


def valid_unsubscribe(user_id: str, token: str) -> bool:
    if not _secret() or not user_id or not token:
        return False
    return hmac.compare_digest(unsubscribe_token(user_id), token)


def unsubscribe_url(user_id: str) -> str | None:
    if not _secret():
        return None
    app = settings.app_url.rstrip("/")
    return f"{app}/api/lifecycle/unsubscribe?u={user_id}&t={unsubscribe_token(user_id)}"


def _telegram_link() -> str:
    return f"https://t.me/{settings.telegram_bot_username or 'yomi_assistant_bot'}"


def _record(user_id: str, step: str, channel: str, now: datetime):
    return Statement(
        'INSERT OR IGNORE INTO "lifecycle_messages" (user_id, step, channel, sent_at) '
        "VALUES (?, ?, ?, ?) RETURNING step",
        [user_id, step, channel, now.isoformat()],
    )


async def opt_out(backend: D1Backend, user_id: str) -> None:
    await backend.store.atomic([
        _record(user_id, OPTED_OUT, "user", datetime.now(UTC)),
    ])


async def _candidates(backend: D1Backend, now: datetime) -> list[dict]:
    return await backend.store.fetch_all(
        'SELECT u.id, u.name, u.email, u.created_at, '
        "(SELECT platform_chat_id FROM platform_connections pc WHERE pc.user_id = u.id "
        "AND pc.platform = 'telegram' AND pc.platform_chat_id IS NOT NULL LIMIT 1) AS chat_id, "
        "(SELECT COUNT(*) FROM mcp_connections c WHERE c.user_id = u.id) + "
        "(SELECT COUNT(*) FROM composio_connections c WHERE c.user_id = u.id "
        "AND c.status = 'ACTIVE') AS apps, "
        "(SELECT COUNT(*) FROM schedules s WHERE s.user_id = u.id) AS routines, "
        "(SELECT MAX(e.created_at) FROM usage_events e WHERE e.user_id = u.id) AS last_active, "
        "(SELECT s.timezone FROM schedules s WHERE s.user_id = u.id "
        "ORDER BY s.created_at DESC LIMIT 1) AS tz, "
        "(SELECT group_concat(m.step) FROM lifecycle_messages m WHERE m.user_id = u.id) AS sent "
        'FROM "user" u '
        "WHERE u.created_at >= ? AND NOT EXISTS (SELECT 1 FROM lifecycle_messages m "
        "WHERE m.user_id = u.id AND (m.step = ? OR (m.channel != ? AND m.sent_at >= ?))) "
        "AND (SELECT COUNT(*) FROM lifecycle_messages m WHERE m.user_id = u.id) < ? "
        "ORDER BY u.created_at LIMIT ?",
        [
            (now - WINDOW).date().isoformat(),
            OPTED_OUT,
            SKIPPED,
            (now - GAP).isoformat(),
            len(NUDGES),
            BATCH,
        ],
    )


def _daytime(tz: str | None, now: datetime) -> bool:
    try:
        zone = ZoneInfo(tz or DEFAULT_TZ)
    except Exception:  # noqa: BLE001 — a bad zone falls back to the default
        zone = ZoneInfo(DEFAULT_TZ)
    return 10 <= now.astimezone(zone).hour < 20


def _applies(nudge: Nudge, row: dict, now: datetime) -> bool:
    if nudge.step == "connect_apps":
        return not int(row.get("apps") or 0)
    if nudge.step == "try_routine":
        return not int(row.get("routines") or 0)
    last = parse_dt(row.get("last_active"))
    return last is None or now - last >= QUIET


async def _deliver(nudge: Nudge, row: dict) -> str | None:
    """The channel the nudge went out on, or None when there's no way to reach them."""
    app = settings.app_url.rstrip("/")
    if row.get("chat_id"):
        from yomi.gateway.telegram import send_message

        await send_message(str(row["chat_id"]), nudge.telegram.format(app=app) + STOP_HINT)
        return "telegram"
    email = str(row.get("email") or "")
    if not (mail.enabled() and mail.deliverable(email)):
        return None
    unsubscribe = unsubscribe_url(str(row["id"]))
    cta_url = f"{app}{nudge.path}" if nudge.path else _telegram_link()
    footer = (
        f'don\'t want tips like this? <a href="{unsubscribe}" style="color:#8a8680">'
        "unsubscribe</a>."
        if unsubscribe
        else None
    )
    text, html = mail.render(
        f"hi {mail.first_name(row.get('name'))},",
        nudge.email,
        cta=(nudge.cta, cta_url),
        footer=footer,
        footer_text=(
            f"don't want tips like this? unsubscribe: {unsubscribe}" if unsubscribe else None
        ),
    )
    sent = await mail.send_email(email, nudge.subject, text, html, unsubscribe_url=unsubscribe)
    return "email" if sent else None


async def send_due(backend: D1Backend, now: datetime | None = None) -> int:
    """Send whatever nudges are due right now. Returns how many went out."""
    now = now or datetime.now(UTC)
    sent_count = 0
    for row in await _candidates(backend, now):
        created = parse_dt(row.get("created_at"))
        if created is None or not _daytime(row.get("tz"), now):
            continue
        done = set(str(row.get("sent") or "").split(",")) & STEPS
        user_id = str(row["id"])
        for nudge in NUDGES:
            if nudge.step in done:
                continue
            if now - created < nudge.after:
                break
            if not _applies(nudge, row, now):
                await backend.store.atomic([_record(user_id, nudge.step, SKIPPED, now)])
                continue
            # Claim first so a slow or overlapping sweep can never send it twice.
            claimed = await backend.store.atomic([
                _record(user_id, nudge.step, "pending", now)
            ])
            if not (claimed and claimed[0].get("results")):
                break
            try:
                channel = await _deliver(nudge, row)
            except Exception as exc:  # noqa: BLE001 — one user must not sink the sweep
                logger.warning("lifecycle nudge failed: %s", type(exc).__name__)
                channel = None
            await backend.store.atomic([
                Statement(
                    'UPDATE "lifecycle_messages" SET channel = ? WHERE user_id = ? AND step = ?',
                    [channel or SKIPPED, user_id, nudge.step],
                )
            ])
            sent_count += channel is not None
            break
    return sent_count
