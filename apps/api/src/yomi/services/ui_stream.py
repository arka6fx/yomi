"""The Vercel AI SDK's UI message stream (v1), spoken by the dashboard conversation.

The dashboard uses ``useChat`` from ``@ai-sdk/react``. It expects Server-Sent Events,
each a JSON "part": ``start``, ``text-start``/``text-delta``/``text-end`` blocks, custom
``data-*`` parts, ``error`` and ``finish``, then ``data: [DONE]``. ``ReplyParts`` turns
the agent loop's events (``{"type": "text"}``, ``{"type": "tool"}``) into those parts;
``parse_message`` reads the user's message (text plus image attachments) off a request.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import uuid
from typing import Any

HEADERS = {
    "x-vercel-ai-ui-message-stream": "v1",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}
DONE = b"data: [DONE]\n\n"

MAX_TEXT = 4000
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 5 * 1024 * 1024
_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$")


class MessageError(ValueError):
    pass


def sse(part: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(part, separators=(',', ':'))}\n\n".encode()


def parse_message(body: Any) -> tuple[str, list[str]]:
    """(text, image data URLs) from ``{"message": UIMessage}``; raises MessageError."""
    message = body.get("message") if isinstance(body, dict) else None
    parts = message.get("parts") if isinstance(message, dict) else None
    if not isinstance(parts, list):
        raise MessageError("no message")
    texts: list[str] = []
    images: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            texts.append(part["text"])
        elif part.get("type") == "file":
            url = str(part.get("url") or "")
            match = _DATA_URL.match(url)
            if not match:
                raise MessageError("photos must be PNG, JPEG, WebP or GIF")
            try:
                size = len(base64.b64decode(match.group(2), validate=False))
            except (binascii.Error, ValueError) as exc:
                raise MessageError("that photo couldn't be read") from exc
            if size > MAX_IMAGE_BYTES:
                raise MessageError("each photo can be at most 5 MB")
            images.append(url)
    if len(images) > MAX_IMAGES:
        raise MessageError(f"send at most {MAX_IMAGES} photos at a time")
    text = "\n".join(t for t in texts if t.strip()).strip()[:MAX_TEXT]
    if not text and not images:
        raise MessageError("say something first")
    return text, images


class ReplyParts:
    """Stateful translation of one agent turn into UI message stream parts."""

    def __init__(self, message_id: str | None = None) -> None:
        self.message_id = message_id or f"msg_{uuid.uuid4().hex}"
        self._text_id: str | None = None
        self._streamed = False

    def start(self) -> list[dict[str, Any]]:
        return [{"type": "start", "messageId": self.message_id}, {"type": "start-step"}]

    def _open(self) -> list[dict[str, Any]]:
        if self._text_id is not None:
            return []
        self._text_id = f"txt_{uuid.uuid4().hex[:12]}"
        return [{"type": "text-start", "id": self._text_id}]

    def _delta(self, text: str) -> list[dict[str, Any]]:
        opened = self._open()
        return [*opened, {"type": "text-delta", "id": self._text_id, "delta": text}]

    def on_event(self, event: dict[str, Any]) -> list[dict[str, Any]]:
        if event.get("type") == "text" and event.get("text"):
            self._streamed = True
            return self._delta(str(event["text"]))
        if event.get("type") == "tool":
            out: list[dict[str, Any]] = []
            if self._text_id is not None:
                # Text before a tool call was the model thinking aloud ("let me check");
                # the answer comes after the tool, so drop it from the message.
                out += [{"type": "text-end", "id": self._text_id}, {"type": "reset-step"}]
                self._text_id = None
                self._streamed = False
            status = {"label": event.get("label") or "working on it", "tool": event.get("name")}
            return [*out, {"type": "data-status", "data": status, "transient": True}]
        return []

    def finish(self, reply: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if not self._streamed and reply:
            # Nothing streamed (e.g. the stream fell back to a plain call): send it whole.
            out += self._delta(reply)
        if self._text_id is not None:
            out.append({"type": "text-end", "id": self._text_id})
            self._text_id = None
        return [*out, {"type": "finish-step"}, {"type": "finish"}]

    def error(self, message: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if self._text_id is not None:
            out.append({"type": "text-end", "id": self._text_id})
            self._text_id = None
        return [*out, {"type": "error", "errorText": message}]
