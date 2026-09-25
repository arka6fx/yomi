import asyncio
import html
import logging
import re
import traceback
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
from yomi.services import billing_d1
from yomi.services.agent.loop import run_agent_loop
from yomi.services.agent.sessions import append_turn, load_history
from yomi.services.cloudflare_storage.deps import D1Backend, get_d1_backend
from yomi.services.metering import ChargeInput, MeteringUser, charge_usage
from yomi.services.transcription import transcribe_audio

logger = logging.getLogger(__name__)

router = APIRouter()

_locks: dict[str, asyncio.Lock] = {}

# Last few gateway failures, for debugging from outside the container.
_gateway_errors: deque[tuple[str, str, str]] = deque(maxlen=20)


def _record_error(kind: str, message: str) -> None:
    detail = f"{message}\n{traceback.format_exc(limit=12)}"
    _gateway_errors.append((datetime.now(UTC).isoformat(), kind, detail))
    logger.error("[telegram] %s: %s", kind, detail)


def recent_gateway_errors() -> list[tuple[str, str, str]]:
    return list(_gateway_errors)


def get_lock(chat_id: str) -> asyncio.Lock:
    if chat_id not in _locks:
        _locks[chat_id] = asyncio.Lock()
    return _locks[chat_id]


async def send_message(chat_id: str | int, text: str) -> None:
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    async with httpx.AsyncClient() as client:
        # Workers AI answers are Markdown, while Telegram otherwise renders
        # the asterisks literally. Convert the common Markdown subset to HTML
        # and fall back to plain text if malformed model output is rejected.
        for chunk in _message_chunks(text):
            rendered = _markdown_to_telegram_html(chunk)
            response = await client.post(
                url,
                json={"chat_id": chat_id, "text": rendered, "parse_mode": "HTML"},
            )
            if response.status_code >= 400:
                await client.post(url, json={"chat_id": chat_id, "text": chunk})


async def send_approval_prompt(chat_id: str | int, action_id: str, meta: dict) -> None:
    """Show a gated action with inline Approve/Reject buttons."""
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
    title = html.escape(str(meta.get("title", "")))
    preview = html.escape(str(meta.get("preview", ""))[:1500])
    text = f"<b>Approval needed</b>\n{title}\n\n{preview}"
    keyboard = {
        "inline_keyboard": [[
            {"text": f"✅ {meta.get('confirm_text') or 'Approve'}", "callback_data": f"act:a:{action_id}"},
            {"text": "✖️ Reject", "callback_data": f"act:r:{action_id}"},
        ]]
    }
    async with httpx.AsyncClient() as client:
        await client.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML", "reply_markup": keyboard},
        )


async def _telegram_call(method: str, payload: dict) -> None:
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"
    async with httpx.AsyncClient() as client:
        await client.post(url, json=payload)


async def _handle_callback(callback: dict, d1: D1Backend | None) -> dict:
    """Inline Approve/Reject taps on approval prompts."""
    data = str(callback.get("data") or "")
    message = callback.get("message") or {}
    chat_id = str((message.get("chat") or {}).get("id") or "")
    tg_user_id = str((callback.get("from") or {}).get("id") or "")
    parts = data.split(":", 2)
    if len(parts) != 3 or parts[0] != "act" or parts[1] not in ("a", "r") or d1 is None:
        await _telegram_call("answerCallbackQuery", {"callback_query_id": callback.get("id")})
        return {"status": "ignored"}

    from yomi.services import actions_d1
    from yomi.services import connectors_d1 as _connectors_d1

    user_id = await _connectors_d1.resolve_platform_user(d1, "telegram", tg_user_id, chat_id)
    if user_id is None:
        await _telegram_call(
            "answerCallbackQuery",
            {"callback_query_id": callback.get("id"), "text": "This chat isn't linked."},
        )
        return {"status": "ok"}
    decision = "approve" if parts[1] == "a" else "reject"
    await _telegram_call(
        "answerCallbackQuery",
        {"callback_query_id": callback.get("id"), "text": "Working on it…" if decision == "approve" else "Cancelled"},
    )
    try:
        outcome = await actions_d1.decide(d1, user_id, parts[2], decision)
        summary = actions_d1.summarize(outcome)
    except actions_d1.ActionNotFound as exc:
        summary = str(exc)
    if message.get("message_id") is not None:
        await _telegram_call(
            "editMessageReplyMarkup",
            {"chat_id": chat_id, "message_id": message["message_id"], "reply_markup": {"inline_keyboard": []}},
        )
    await send_message(chat_id, summary)
    return {"status": "ok"}


def _message_chunks(text: str, limit: int = 3900) -> list[str]:
    """Keep Telegram's 4096-character limit without dropping the tail."""
    if not text:
        return [""]
    return [text[index : index + limit] for index in range(0, len(text), limit)]


def _markdown_to_telegram_html(text: str) -> str:
    """Render safe, common LLM Markdown without exposing arbitrary HTML."""
    escaped = html.escape(text, quote=False)
    code_blocks: list[str] = []

    def stash_code(match: re.Match[str]) -> str:
        code_blocks.append(f"<pre><code>{match.group(1).strip()}</code></pre>")
        return f"\x00CODE{len(code_blocks) - 1}\x00"

    escaped = re.sub(r"```(?:[A-Za-z0-9_+-]+)?\n?(.*?)```", stash_code, escaped, flags=re.DOTALL)
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r'<a href="\2">\1</a>',
        escaped,
    )
    escaped = re.sub(r"`([^`\n]+)`", r"<code>\1</code>", escaped)
    escaped = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: f"<b>{m.group(1) or m.group(2)}</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)", lambda m: f"<i>{m.group(1) or m.group(2)}</i>", escaped)
    escaped = re.sub(r"^#{1,6}\s+(.+)$", r"<b>\1</b>", escaped, flags=re.MULTILINE)
    escaped = re.sub(r"^\s*[-*]\s+", "• ", escaped, flags=re.MULTILINE)
    # Models occasionally emit an unmatched emphasis marker (for example a
    # response beginning with ``**``). Never leak Markdown control characters
    # into Telegram's user-facing HTML fallback.
    escaped = escaped.replace("**", "").replace("__", "")
    for index, block in enumerate(code_blocks):
        escaped = escaped.replace(f"\x00CODE{index}\x00", block)
    return escaped


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


async def _resolve_yomi_user(
    db_session: AsyncSession, tg_user_id: str, chat_id: str,
    d1: D1Backend | None = None,
) -> User | None:
    """Map a Telegram identity to the linked Yomi account via platform_connections."""
    if d1 is not None:
        from yomi.services import auth_d1 as _auth_d1
        from yomi.services import connectors_d1 as _connectors_d1

        user_id = await _connectors_d1.resolve_platform_user(d1, "telegram", tg_user_id, chat_id)
        if user_id is None:
            return None
        return await _auth_d1.find_user_by_id(d1, user_id)
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


async def _link_with_code(
    db_session: AsyncSession, tg_user_id: str, chat_id: str, code: str,
    d1: D1Backend | None = None,
) -> None:
    """Consume a TelegramLinkToken code and persist the platform connection."""
    if d1 is not None:
        from yomi.services import connectors_d1 as _connectors_d1

        await _connectors_d1.link_with_code(d1, "telegram", tg_user_id, chat_id, code)
        return
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


async def _handle_update(
    update: dict, db_session: AsyncSession, d1: D1Backend | None = None
) -> dict:
    if update.get("callback_query"):
        return await _handle_callback(update["callback_query"], d1)
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
            await _link_with_code(db_session, tg_user_id, chat_id, code, d1)
            await send_message(chat_id, "Account linked. Send me a message or voice note to get started.")
        except ValueError as exc:
            await send_message(chat_id, str(exc))
        return {"status": "ok"}
    elif text == "/help":
        await send_message(chat_id, "I'm the Yomi agent. Send me a message or voice note!")
        return {"status": "ok"}
    elif text == "/reset":
        if d1 is not None:
            # Resolve via the connector identity (same lookup as normal messages).
            from yomi.services import connectors_d1 as _connectors_d1
            from yomi.services.agent import sessions_d1

            user_id = await _connectors_d1.resolve_platform_user(
                d1, "telegram", tg_user_id, chat_id
            )
            if user_id is not None:
                await sessions_d1.clear_history(d1, user_id, "telegram", chat_id)
        else:
            from yomi.services.agent.sessions import _sessions

            if chat_id in _sessions:
                del _sessions[chat_id]
        await send_message(chat_id, "History cleared.")
        return {"status": "ok"}

    row = await _resolve_yomi_user(db_session, tg_user_id, chat_id, d1)
    if row is None:
        await send_message(
            chat_id,
            "Your Telegram isn't linked to a Yomi account yet. Open the dashboard, go to Settings, "
            "then send /start <code> here with the code you see.",
        )
        return {"status": "ok"}
    user = _metering_user(row)

    if d1 is not None:
        return await _enqueue_telegram_run(
            update, d1, user, chat_id, message_id, text,
            kind="voice" if voice else "chat", duration_seconds=duration_seconds,
        )

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
            if d1 is not None:
                charge_res = await billing_d1.charge_usage(d1, charge)
            else:
                charge_res = await charge_usage(db_session, charge)

            if not charge_res.ok:
                await send_message(chat_id, charge_res.message)
                return {"status": "ok"}

            append_turn(chat_id, "user", text)
            history = load_history(chat_id)

            async def run_with_timeout():
                # Canonical user id (not the chat id): connector lookup, the
                # Composio entity, and usage metering all key on the Yomi user.
                # History stays chat-scoped via the messages payload.
                if d1 is not None:
                    from yomi.services import connectors_d1 as _connectors_d1

                    pending_hook = _connectors_d1.create_pending_action(
                        d1, user_id=user["id"],
                        source_platform="telegram", source_chat_id=chat_id,
                    )
                else:
                    pending_hook = create_pending_action(
                        db_session, user_id=user["id"],
                        source_platform="telegram", source_chat_id=chat_id,
                    )
                return await run_agent_loop(
                    history,
                    user["id"],
                    user["plan"] or "explore",
                    db_session=db_session,
                    create_pending_action=pending_hook,
                    d1=d1,
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


async def _enqueue_telegram_run(
    update: dict,
    d1: D1Backend,
    user: MeteringUser,
    chat_id: str,
    message_id: int | None,
    text: str,
    kind: str,
    duration_seconds: int | None,
) -> dict:
    """Durable path: persist the run (redeliveries dedupe on update_id) and
    process it in a background task so the webhook returns immediately."""
    from yomi.services import runs_d1

    update_id = update.get("update_id")
    run, created = await runs_d1.create_run(
        d1,
        user_id=str(user["id"]),
        platform="telegram",
        chat_id=chat_id,
        message_id=message_id if isinstance(message_id, int) else None,
        update_id=str(update_id) if update_id is not None else None,
        kind=kind,
        input_text=text,
        duration_seconds=duration_seconds,
        plan=user.get("plan") or "explore",
    )
    if not created:
        return {"status": "ok", "deduplicated": True}
    asyncio.create_task(_background_telegram_run(
        str(run["id"]), dict(user), chat_id, message_id, text, kind, duration_seconds,
    ))
    return {"status": "queued", "runId": str(run["id"])}


async def _background_telegram_run(
    run_id: str,
    user: dict,
    chat_id: str,
    message_id: int | None,
    text: str,
    kind: str,
    duration_seconds: int | None,
) -> None:
    """Execute one enqueued run with self-owned backends (the request scope,
    including its Postgres session and HTTP client, is long gone)."""
    from yomi.services import runs_d1
    from yomi.services.cloudflare_storage.deps import open_d1_backend

    try:
        async with open_d1_backend() as backend:
            claimed = await runs_d1.claim_run(backend, run_id, f"webhook-{run_id[:8]}")
            if claimed is None:
                return
            await _execute_telegram_run(
                backend, user, chat_id, message_id, text, kind,
                duration_seconds, run_id, user.get("plan") or "explore",
            )
    except Exception as exc:
        _record_error("agent", f"background run {run_id} crashed: {type(exc).__name__}: {exc}")


async def execute_telegram_run(
    backend: D1Backend,
    user: dict,
    chat_id: str,
    message_id: int | None,
    text: str,
    kind: str,
    duration_seconds: int | None,
    run_id: str,
    plan: str,
) -> None:
    """Shared execution core for webhook tasks and the dispatch sweeper."""
    await _execute_telegram_run(
        backend, user, chat_id, message_id, text, kind, duration_seconds, run_id, plan
    )


async def _execute_telegram_run(
    backend: D1Backend,
    user: dict,
    chat_id: str,
    message_id: int | None,
    text: str,
    kind: str,
    duration_seconds: int | None,
    run_id: str,
    plan: str,
) -> None:
    from yomi.services import connectors_d1, runs_d1
    from yomi.services.agent import sessions_d1

    lock = get_lock(chat_id)
    async with lock:
        try:
            from yomi.services import runs_d1

            await runs_d1.heartbeat(backend, run_id)
            if kind == "voice":
                charge = ChargeInput(user=user, kind="voice", duration_seconds=duration_seconds)
            elif kind == "schedule":
                charge = ChargeInput(user=user, kind="agent", units=1)
            else:
                charge = ChargeInput(user=user, kind="chat", units=1)
            # Run-scoped idempotency: a crash retry replays the recorded
            # outcome instead of charging twice.
            charge_res = await billing_d1.charge_usage(
                backend, charge, idempotency_key=f"run:{run_id}:charge"
            )
            if not charge_res.ok:
                await send_message(chat_id, charge_res.message)
                await runs_d1.complete_run(backend, run_id, charge_res.message)
                return

            user_id = str(user["id"])
            await sessions_d1.append_turn(backend, user_id, "telegram", chat_id, "user", text)
            history = await sessions_d1.load_history(backend, user_id, "telegram", chat_id)
            pending_hook = connectors_d1.create_pending_action(
                backend, user_id=user_id,
                source_platform="telegram", source_chat_id=chat_id,
            )
            reply = await asyncio.wait_for(
                run_agent_loop(
                    history,
                    user_id,
                    plan,
                    db_session=None,
                    create_pending_action=pending_hook,
                    d1=backend,
                ),
                timeout=120.0,
            )
            await sessions_d1.append_turn(backend, user_id, "telegram", chat_id, "assistant", reply)
            await send_message(chat_id, reply)
            if message_id is not None:
                await set_reaction(chat_id, message_id, "👍")
            await runs_d1.complete_run(backend, run_id, reply[:500])
        except TimeoutError:
            _record_error("agent", f"run {run_id} timed out after 120s")
            outcome = await runs_d1.fail_run(backend, run_id, "timed out after 120s")
            if outcome == "failed" and message_id is not None:
                await set_reaction(chat_id, message_id, "❌")
        except Exception as exc:
            _record_error("agent", f"run {run_id}: {type(exc).__name__}: {exc}")
            outcome = await runs_d1.fail_run(backend, run_id, f"{type(exc).__name__}: {exc}")
            if outcome == "failed":
                await send_message(chat_id, "That hit an error after retries — try again shortly.")
                if message_id is not None:
                    await set_reaction(chat_id, message_id, "❌")


@router.post("/telegram")
async def telegram_webhook(
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if not _telegram_request_authentic(request):
        raise HTTPException(status_code=403, detail="invalid secret token")
    return await _handle_update(await request.json(), db_session, d1)


@router.post("/telegram/webhook/{token}")
async def telegram_webhook_with_token(
    token: str,
    request: Request,
    db_session: AsyncSession = Depends(get_db_session),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    if token != settings.telegram_bot_token:
        raise HTTPException(status_code=404, detail="not found")
    if not _telegram_request_authentic(request):
        raise HTTPException(status_code=403, detail="invalid secret token")
    return await _handle_update(await request.json(), db_session, d1)
