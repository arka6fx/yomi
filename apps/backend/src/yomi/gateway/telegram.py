import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.connectors.pending import create_pending_action
from yomi.db_session import get_db_session
from yomi.services.agent.loop import run_agent_loop
from yomi.services.agent.sessions import append_turn, load_history
from yomi.services.metering import ChargeInput, charge_usage
from yomi.services.transcription import transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()

_locks: dict[str, asyncio.Lock] = {}


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


async def _handle_update(update: dict, db_session: AsyncSession) -> dict:
    message = update.get("message")
    if not message:
        return {"status": "ignored"}

    chat_id = str(message.get("chat", {}).get("id"))
    message_id = message.get("message_id")
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
            text = await transcribe_audio(audio, mime_type=voice.get("mime_type"))
        except Exception as exc:
            logger.error("STT failed chat=%s err=%s", chat_id, exc)
            await send_message(chat_id, "Couldn't transcribe that voice note — try again or type instead.")
            if message_id is not None:
                await set_reaction(chat_id, message_id, "❌")
            return {"status": "ok"}

    if not text:
        return {"status": "ignored"}

    if text == "/start":
        await send_message(chat_id, "Welcome! Please link your account with /start <code>")
        return {"status": "ok"}
    elif text.startswith("/start "):
        code = text.split(" ")[1]
        await send_message(chat_id, f"Linking account with code {code}...")
        return {"status": "ok"}
    elif text == "/help":
        await send_message(chat_id, "I'm the Yomi agent. Send me a message!")
        return {"status": "ok"}
    elif text == "/reset":
        # clear history
        from yomi.services.agent.sessions import _sessions

        if chat_id in _sessions:
            del _sessions[chat_id]
        await send_message(chat_id, "History cleared.")
        return {"status": "ok"}

    lock = get_lock(chat_id)
    if lock.locked():
        await send_message(chat_id, "I'm still processing your previous message.")
        return {"status": "ok"}

    async with lock:
        try:
            # Fake user for metering
            user = {"id": chat_id, "plan": "explore", "subscription_status": "active"}
            charge = (
                ChargeInput(user=user, kind="voice", duration_seconds=duration_seconds)
                if voice
                else ChargeInput(user=user, kind="chat", units=1)
            )
            charge_res = await charge_usage(db_session, charge)  # type: ignore[arg-type]

            if not charge_res.ok:
                await send_message(chat_id, charge_res.message)  # type: ignore[attr-defined]
                return {"status": "ok"}

            append_turn(chat_id, "user", text)
            history = load_history(chat_id)

            async def run_with_timeout():
                return await run_agent_loop(
                    history,
                    chat_id,
                    "explore",
                    db_session=db_session,
                    create_pending_action=create_pending_action(
                        db_session, user_id=chat_id, source_platform="telegram", source_chat_id=chat_id
                    ),
                )

            reply = await asyncio.wait_for(run_with_timeout(), timeout=120.0)

            append_turn(chat_id, "assistant", reply)
            await send_message(chat_id, reply)
            await set_reaction(chat_id, message_id, "👍")

        except TimeoutError:
            await send_message(chat_id, "That took too long...")
            if message_id is not None:
                await set_reaction(chat_id, message_id, "❌")
        except Exception as e:
            logger.error(f"Error processing telegram update: {e}")
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