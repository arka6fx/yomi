"""The dashboard chat: AI SDK UI message stream parts, attachments, and transcription."""

from __future__ import annotations

import base64
import json

import pytest
from d1_sqlite import sqlite_backend
from fastapi import FastAPI
from fastapi.testclient import TestClient

from yomi.app.deps import get_current_user
from yomi.app.routes.conversation import conversation_router
from yomi.services import ui_stream
from yomi.services.agent import sessions_d1
from yomi.services.cloudflare_storage.deps import get_d1_backend

PNG_URL = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\0" * 32).decode()


def _message(*parts: dict) -> dict:
    return {"message": {"id": "m1", "role": "user", "parts": list(parts)}}


def _parse_sse(body: str) -> list:
    out = []
    for block in body.split("\n\n"):
        if block.startswith("data: "):
            payload = block[len("data: "):]
            out.append(payload if payload == "[DONE]" else json.loads(payload))
    return out


def test_parse_message_reads_text_and_photos():
    text, images = ui_stream.parse_message(
        _message(
            {"type": "text", "text": "what's this?"},
            {"type": "file", "mediaType": "image/png", "url": PNG_URL},
        )
    )
    assert text == "what's this?"
    assert images == [PNG_URL]
    # a photo alone is fine
    assert ui_stream.parse_message(_message({"type": "file", "url": PNG_URL})) == ("", [PNG_URL])


@pytest.mark.parametrize(
    ("parts", "error"),
    [
        ([], "say something"),
        ([{"type": "text", "text": "   "}], "say something"),
        ([{"type": "file", "url": "data:image/svg+xml;base64,PHN2Zz4="}], "PNG, JPEG"),
        ([{"type": "file", "url": "https://evil.example/x.png"}], "PNG, JPEG"),
        ([{"type": "file", "url": PNG_URL}] * 5, "at most 4"),
    ],
)
def test_parse_message_rejects_bad_input(parts, error):
    with pytest.raises(ui_stream.MessageError, match=error):
        ui_stream.parse_message(_message(*parts))


def test_parse_message_rejects_huge_photos():
    raw = b"\0" * (ui_stream.MAX_IMAGE_BYTES + 1)
    big = "data:image/jpeg;base64," + base64.b64encode(raw).decode()
    with pytest.raises(ui_stream.MessageError, match="5 MB"):
        ui_stream.parse_message(_message({"type": "file", "url": big}))


def test_reply_parts_stream_text_then_finish():
    parts = ui_stream.ReplyParts("msg_1")
    out = parts.start()
    out += parts.on_event({"type": "text", "text": "hel"})
    out += parts.on_event({"type": "text", "text": "lo"})
    out += parts.finish("hello")
    types = [p["type"] for p in out]
    assert types == ["start", "start-step", "text-start", "text-delta", "text-delta", "text-end",
                     "finish-step", "finish"]
    assert out[0]["messageId"] == "msg_1"
    assert "".join(p["delta"] for p in out if p["type"] == "text-delta") == "hello"
    ids = {p["id"] for p in out if "id" in p}
    assert len(ids) == 1


def test_tool_drops_thinking_aloud_and_sends_a_transient_status():
    parts = ui_stream.ReplyParts()
    parts.start()
    out = parts.on_event({"type": "text", "text": "let me check"})
    out += parts.on_event({"type": "tool", "name": "gmail_search", "label": "checking your inbox"})
    out += parts.on_event({"type": "text", "text": "2 new emails"})
    out += parts.finish("2 new emails")
    types = [p["type"] for p in out]
    assert types[:5] == ["text-start", "text-delta", "text-end", "reset-step", "data-status"]
    status = out[4]
    assert status["transient"] is True and status["data"]["label"] == "checking your inbox"
    assert [p["delta"] for p in out if p["type"] == "text-delta"][-1] == "2 new emails"


def test_reply_that_never_streamed_is_sent_whole():
    parts = ui_stream.ReplyParts()
    out = parts.finish("done!")
    assert [p["type"] for p in out] == [
        "text-start", "text-delta", "text-end", "finish-step", "finish",
    ]


def _client(monkeypatch, loop):
    backend = sqlite_backend("alice")
    monkeypatch.setattr("yomi.services.agent.loop.run_agent_loop", loop)
    app = FastAPI()
    app.include_router(conversation_router)

    class _User:
        id = "alice"
        plan = "free"

    app.dependency_overrides[get_current_user] = lambda: _User()
    app.dependency_overrides[get_d1_backend] = lambda: backend
    return TestClient(app), backend


async def test_chat_route_streams_ui_message_parts_and_sends_photos_to_the_model(monkeypatch):
    seen: dict = {}

    async def fake_loop(history, user_id, plan, on_event=None, **_):
        seen["last"] = history[-1]
        await on_event({"type": "tool", "name": "web_search", "label": "searching the web"})
        await on_event({"type": "text", "text": "a cat"})
        return "a cat"

    client, backend = _client(monkeypatch, fake_loop)
    res = client.post(
        "/api/conversation/shared/chat",
        json=_message({"type": "text", "text": "what is this?"}, {"type": "file", "url": PNG_URL}),
    )
    assert res.status_code == 200
    assert res.headers["x-vercel-ai-ui-message-stream"] == "v1"
    assert res.headers["content-type"].startswith("text/event-stream")
    parts = _parse_sse(res.text)
    assert parts[-1] == "[DONE]"
    types = [p["type"] for p in parts[:-1]]
    assert types[0] == "start" and types[-1] == "finish"
    assert "data-status" in types and "text-delta" in types

    content = seen["last"]["content"]
    assert content[0] == {"type": "text", "text": "what is this?"}
    assert content[1] == {"type": "image_url", "image_url": {"url": PNG_URL}}
    history = await sessions_d1.load_history(backend, "alice", "web", "alice")
    assert [t["content"] for t in history] == ["what is this?\n(sent a photo)", "a cat"]


def test_chat_route_rejects_bad_messages(monkeypatch):
    async def never(*_, **__):
        raise AssertionError("should not run")

    client, _ = _client(monkeypatch, never)
    res = client.post("/api/conversation/shared/chat", json=_message({"type": "text", "text": " "}))
    assert res.status_code == 422


def test_chat_route_reports_errors_in_the_stream(monkeypatch):
    async def broken(*_, **__):
        raise RuntimeError("model down")

    client, _ = _client(monkeypatch, broken)
    parts = _parse_sse(client.post("/api/conversation/shared/chat", json=_message(
        {"type": "text", "text": "hi"})).text)
    assert {"type": "error", "errorText": "Yomi hit an error; try again"} in parts
    assert parts[-1] == "[DONE]"


def test_transcribe_returns_text(monkeypatch):
    async def fake_transcribe(data, mime_type=None):
        assert mime_type == "audio/webm"
        return "remind me at six"

    monkeypatch.setattr("yomi.services.transcription.transcribe_audio", fake_transcribe)
    client, _ = _client(monkeypatch, None)
    res = client.post(
        "/api/conversation/transcribe?seconds=3",
        content=b"\x1a\x45\xdf\xa3" + b"\0" * 2000,
        headers={"content-type": "audio/webm"},
    )
    assert res.status_code == 200
    assert res.json() == {"text": "remind me at six"}


def test_transcribe_rejects_empty_recordings(monkeypatch):
    client, _ = _client(monkeypatch, None)
    res = client.post(
        "/api/conversation/transcribe", content=b"x", headers={"content-type": "audio/webm"}
    )
    assert res.status_code == 422
