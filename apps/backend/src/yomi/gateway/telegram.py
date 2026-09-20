import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.conf import settings
from yomi.connectors.pending import create_pending_action
from yomi.db_session import get_db_session
from yomi.services.agent.loop import run_agent_loop
from yomi.services.agent.sessions import append_turn, load_history
from yomi.services.metering import ChargeInput, charge_usage

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
        await client.post(url, json={
            "chat_id": chat_id, 
            "message_id": message_id, 
            "reaction": [{"type": "emoji", "emoji": emoji}]
        })

@router.post("/telegram")
async def telegram_webhook(request: Request, db_session: AsyncSession = Depends(get_db_session)):
    update = await request.json()
    message = update.get("message")
    if not message:
        return {"status": "ignored"}
        
    chat_id = str(message.get("chat", {}).get("id"))
    text = message.get("text", "")
    message_id = message.get("message_id")
    
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
            charge_res = await charge_usage(db_session, ChargeInput(user=user, kind="chat", units=1)) # type: ignore
            
            if not charge_res.ok:
                await send_message(chat_id, charge_res.message) # type: ignore
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
                        db_session,
                        user_id=chat_id,
                        source_platform="telegram",
                        source_chat_id=chat_id,
                    ),
                )
                
            reply = await asyncio.wait_for(run_with_timeout(), timeout=120.0)
            
            append_turn(chat_id, "assistant", reply)
            await send_message(chat_id, reply)
            await set_reaction(chat_id, message_id, "👍")
            
        except TimeoutError:
            await send_message(chat_id, "That took too long...")
            await set_reaction(chat_id, message_id, "❌")
        except Exception as e:
            logger.error(f"Error processing telegram update: {e}")
            await set_reaction(chat_id, message_id, "❌")
            
    return {"status": "ok"}
