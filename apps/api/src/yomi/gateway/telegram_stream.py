"""Stream an agent reply into one Telegram message as it's written.

The first words go out as a new message the moment the model produces them; the
same message is then edited as more text arrives, at most about once a second
(Telegram rate-limits edits). While a tool runs the message shows what yomi is
doing. ``finish`` settles the final text, splitting anything over Telegram's
length limit into follow-up messages.

Streaming is best effort: any Telegram failure is swallowed and ``finish`` falls
back to sending the reply the plain way, so a reply is never lost to it.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

# (method, payload) -> decoded Telegram response, or None on a transport failure.
TelegramCall = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any] | None]]

EDIT_INTERVAL_S = 1.0
# Don't spend an edit on a few characters; wait until the text has grown a bit.
MIN_GROWTH = 24


class ReplyStream:
    def __init__(
        self,
        chat_id: str | int,
        call: TelegramCall,
        render: Callable[[str], str],
        chunks: Callable[[str], list[str]],
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.chat_id = chat_id
        self._call = call
        self._render = render
        self._chunks = chunks
        self._clock = clock
        self.message_id: int | None = None
        self._text = ""
        self._status = ""
        self._shown = ""
        self._last_edit = 0.0
        self._broken = False

    async def on_event(self, event: dict[str, Any]) -> None:
        """Feed ``run_agent_loop``'s ``on_event`` stream."""
        if event.get("type") == "text":
            self._text += str(event.get("text") or "")
            if len(self._text) - len(self._shown) >= MIN_GROWTH:
                await self._flush()
        elif event.get("type") == "tool":
            # Text written before a tool call was the model thinking aloud; the
            # answer comes after the tool, so show the step instead.
            self._text = ""
            self._status = f"⏳ {event.get('label') or 'working on it'}…"
            await self._flush(force=True)

    async def finish(self, reply: str, send_plain: Callable[[str], Awaitable[None]]) -> None:
        """Show the final reply: edit the streamed message into it, or send it fresh."""
        reply = reply.strip() or "👍"
        parts = self._chunks(reply)
        first, rest = parts[0], parts[1:]
        if self.message_id is None or self._broken or not await self._edit(first, final=True):
            await send_plain(first)
        for part in rest:
            await send_plain(part)

    async def _flush(self, force: bool = False) -> None:
        if self._broken:
            return
        now = self._clock()
        if not force and now - self._last_edit < EDIT_INTERVAL_S:
            return
        visible = self._text or self._status
        if not visible or visible == self._shown:
            return
        # A streamed draft never exceeds one message; the tail waits for finish().
        visible = self._chunks(visible)[0]
        self._last_edit = now
        if self.message_id is None:
            await self._send_first(visible)
        else:
            await self._edit(visible)

    async def _send_first(self, text: str) -> None:
        data = await self._call(
            "sendMessage",
            {"chat_id": self.chat_id, "text": self._render(text), "parse_mode": "HTML"},
        )
        result = (data or {}).get("result") if (data or {}).get("ok") else None
        if isinstance(result, dict) and isinstance(result.get("message_id"), int):
            self.message_id = result["message_id"]
            self._shown = text
        else:
            # Can't stream into a message we don't have; finish() sends normally.
            self._broken = True

    async def _edit(self, text: str, final: bool = False) -> bool:
        payload = {
            "chat_id": self.chat_id,
            "message_id": self.message_id,
            "text": self._render(text),
            "parse_mode": "HTML",
        }
        data = await self._call("editMessageText", payload)
        ok = bool(data and (data.get("ok") or "not modified" in str(data.get("description"))))
        if not ok and final:
            # Malformed markup for this text: fall back to plain text in place.
            plain = {"chat_id": self.chat_id, "message_id": self.message_id, "text": text}
            data = await self._call("editMessageText", plain)
            ok = bool(data and data.get("ok"))
        if ok:
            self._shown = text
        return ok
