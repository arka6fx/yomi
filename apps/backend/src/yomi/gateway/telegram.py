import asyncio
import logging
from collections import deque
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.connectors.pending import create_pending_action
from yomi.db.models_app2 import PlatformConnection, TelegramLinkToken
from yomi.db.models_auth import User
from yomi.db_session import get_db_session
from yomi.services.agent.loop import run_agent_loop
from yomi.services.agent.sessions import append_turn, load_history
from yomi.services.metering import ChargeInput, MeteringUser, charge_usage
from yomi.services.transcription import transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()

_locks: dict[str, asyncio.Lock] = {}

# Last few gateway failures, for debugging from outside the container.
_gateway_errors: deque[tuple[str, str, str]] = deque(maxlen=20)


def _record_error(kind: str, message: str) -> None:
    _gateway_errors.append((datetime.now(UTC).isoformat(), kind, message))
    logger.error("[telegram] %s: %s", kind, message)


def recent_gateway_errors() -> list[tuple[str, str, str]]:
    return list(_gateway_errors)


def get_lock(chat_id: str) -> asyncio.Lock:
    if chat_id not in _locks:
        _locks[chat_id] = asyncio.Lock()
    return _locks[chat_id]


async def send_message(chat_id: str | int, text: str) -> None:
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    async with httpx.AsyncClient() as client:
        await client.post(url, json={"chat_id": chat_id, "text": text})


async def download_file(file_id: str) -> bytes:
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/getFile"
    async with httpx.AsyncClient() as client:
        res = await client.post(url, json={"file_id": file_id})
        res.raise_for_status()
        file_path = res.json().get("result", {}).get("file_path")

        file_url = f"https://api.telegram.org/file/bot{settings.telegram_bot_token}/{file_path}"
        res2 = await client.get(file_url)
        res2.raise_for_status()
        return res2.content


async def set_reaction(chat_id: str | int, message_id: int, emoji: str) -> None:
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/setMessageReaction"
    async with httpx.AsyncClient() as client:
        await client.post(
            url,
            json={"chat_id": chat_id, "message_id": message_id, "reaction": [{"type": "emoji", "emoji": emoji}]},
        )


def _telegram_request_authentic(request: Request) -> bool:
    """Optional hardening: when a webhook secret is configured, Telegram must send it."""
    secret = settings.telegram_webhook_secret
    return not secret or request.headers.get("X-Telegram-Bot-Api-Secret-Token") == secret


async def _resolve_yomi_user(db_session: AsyncSession, tg_user_id: str, chat_id: str) -> User | None:
    """Map a Telegram identity to the linked Yomi account via platform_connections."""
    connection = (
        await db_session.execute(
            select(PlatformConnection).where(
                PlatformConnection.platform == "telegram",
                or_(
                    PlatformConnection.platform_user_id == tg_user_id,
                    PlatformConnection.platform_chat_id == chat_id,
                ),
            )
        )
    ).scalar_one_or_none()
    if connection is None:
        return None
    return (
        await db_session.execute(select(User).where(User.id == connection.user_id))
    ).scalar_one_or_none()


def _metering_user(row: User) -> MeteringUser:
    return {
        "id": row.id,
        "email": row.email,
        "role": row.role,
        "plan": row.plan,
        "subscription_status": row.subscription_status,
        "current_period_end": row.current_period_end,
        "trial_end_date": row.trial_end_date,
        "created_at": row.created_at,
    }


async def _link_with_code(db_session: AsyncSession, tg_user_id: str, chat_id: str, code: str) -> None:
    """Consume a TelegramLinkToken code and persist the platform connection."""
    token = (
        await db_session.execute(select(TelegramLinkToken).where(TelegramLinkToken.token == code))
    ).scalar_one_or_none()
    if token is None or token.used or token.expires_at <= datetime.now(UTC).replace(tzinfo=None):
        raise ValueError("invalid or expired link code")

    token.used = True
    token.telegram_user_id = tg_user_id
    db_session.add(
        pg_insert(PlatformConnection)
        .values(
            user_id=token.user_id,
            platform="telegram",
            platform_user_id=tg_user_id,
            platform_chat_id=chat_id,
        )
        .on_conflict_do_update(
            index_elements=["platform", "platform_user_id"],
            set_={"user_id": token.user_id, "platform_chat_id": chat_id},
        )
    )
    await db_session.commit()


async def _handle_update(update: dict, db_session: AsyncSession) -> dict:
    message = update.get("message")
    if not message:
        return {"status": "ignored"}

    chat_id = str(message.get("chat", {}).get("id"))
    message_id = message.get("message_id")
    tg_user_id = str(message.get("from", {}).get("id") or "")
    voice = message.get("voice")
    text = (message.get("text") or "").strip()
    duration_seconds: int | None = None

    if voice:
        # STT: download the voice note and transcribe it; replies are always text.
        duration_seconds = int(voice.get("duration") or 0)
        file_id = voice.get("file_id")
        if not file_id:
            return {"status": "ignored"}
        try:
            audio = await download_file(file_id)
            try:
                text = await transcribe_audio(audio, mime_type=voice.get("mime_type"))
            except Exception:
                _record_error("stt", "first attempt failed, retrying once")
                text = await transcribe_audio(audio, mime_type=voice.get("mime_type"))
        except Exception as exc:
            _record_error("stt", f"{type(exc).__name__}: {exc}")
            await send_message(chat_id, "Couldn't transcribe that voice note — try again or type instead.")
            if message_id is not None:
                await set_reaction(chat_id, message_id, "❌")
            return {"status": "ok"}

    if not text:
        return {"status": "ignored"}

    if text == "/start":
        await send_message(chat_id, "Welcome! Send /start <code> with the code from the dashboard to link your account.")
        return {"status": "ok"}
    elif text.startswith("/start "):
        code = text.split(" ")[1]
        try:
            await _link_with_code(db_session, tg_user_id, chat_id, code)
            await send_message(chat_id, "Account linked. Send me a message or voice note to get started.")
        except ValueError as exc:
            await send_message(chat_id, str(exc))
        return {"status": "ok"}
    elif text == "/help":
        await send_message(chat_id, "I'm the Yomi agent. Send me a message or voice note!")
        return {"status": "ok"}
    elif text == "/reset":
        # clear history
        from yomi.services.agent.sessions import _sessions

        if chat_id in _sessions:
            del _sessions[chat_id]
        await send_message(chat_id, "History cleared.")
        return {"status": "ok"}

    row = await _resolve_yomi_user(db_session, tg_user_id, chat_id)
    if row is None:
        await send_message(
            chat_id,
            "Your Telegram isn't linked to a Yomi account yet. Open the dashboard, go to Settings, "
            "then send /start <code> here with the code you see.",
        )
        return {"status": "ok"}
    user = _metering_user(row)

    lock = get_lock(chat_id)
    if lock.locked():
        await send_message(chat_id, "I'm still processing your previous message.")
        return {"status": "ok"}

    async with lock:
        try:
            charge = (
                ChargeInput(user=user, kind="voice", duration_seconds=duration_seconds)
                if voice
                else ChargeInput(user=user, kind="chat", units=1)
            )
            charge_res = await charge_usage(db_session, charge)

            if not charge_res.ok:
                await send_message(chat_id, charge_res.message)
                return {"status": "ok"}

            append_turn(chat_id, "user", text)
            history = load_history(chat_id)

            async def run_with_timeout():
                return await run_agent_loop(
                    history,
                    chat_id,
                    user["plan"] or "explore",
                    db_session=db_session,
                    create_pending_action=create_pending_action(
                        db_session, user_id=user["id"], source_platform="telegram", source_chat_id=chat_id
                    ),
                )

            reply = await asyncio.wait_for(run_with_timeout(), timeout=120.0)

            append_turn(chat_id, "assistant", reply)
            await send_message(chat_id, reply)
            if message_id is not None:
                await set_reaction(chat_id, message_id, "👍")

        except TimeoutError:
            _record_error("agent", "timed out after 120s")
            await send_message(chat_id, "That took too long...")
            if message_id is not None:
                await set_reaction(chat_id, message_id, "❌")
        except Exception as exc:
            _record_error("agent", f"{type(exc).__name__}: {exc}")
            if message_id is not None:
                await set_reaction(chat_id, message_id, "❌")

    return {"status": "ok"}


@router.post("/telegram")
async def telegram_webhook(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    if not _telegram_request_authentic(request):
        raise HTTPException(status_code=403, detail="invalid secret token")
    return await _handle_update(await request.json(), db_session)


@router.post("/telegram/webhook/{token}")
async def telegram_webhook_with_token(
    token: str, request: Request, db_session: AsyncSession = Depends(get_db_session)
):
    if token != settings.telegram_bot_token:
        raise HTTPException(status_code=404, detail="not found")
    if not _telegram_request_authentic(request):
        raise HTTPException(status_code=403, detail="invalid secret token")
    return await _handle_update(await request.json(), db_session)