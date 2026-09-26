"""Streaming replies: the Workers AI stream parser, loop events, and the dashboard route."""

from __future__ import annotations

import json

import httpx
from d1_sqlite import sqlite_backend
from fastapi import FastAPI
from fastapi.testclient import TestClient

from yomi.app.deps import get_current_user
from yomi.app.routes.conversation import conversation_router
from yomi.services import llm
from yomi.services.agent import loop, sessions_d1
from yomi.services.cloudflare_storage.deps import get_d1_backend


def _sse(*chunks: dict) -> bytes:
    body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode()


def _delta(**delta) -> dict:
    return {"choices": [{"index": 0, "delta": delta, "finish_reason": None}]}


def _use_stream(monkeypatch, body: bytes) -> list[dict]:
    sent: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr("yomi.services.http_pool.shared_client", lambda: client)
    monkeypatch.setattr(llm, "chat_endpoint", lambda: ("https://ai.test/chat", "t", "m"))
    monkeypatch.setattr(llm, "model_for", lambda purpose: "m")
    return sent


async def test_stream_passes_text_along_and_rebuilds_tool_calls(monkeypatch):
    sent = _use_stream(monkeypatch, _sse(
        _delta(content="", role="assistant"),
        _delta(content="Let me "),
        _delta(content="check."),
        _delta(tool_calls=[{"index": 0, "id": "c1", "type": "function",
                            "function": {"name": "get_weather", "arguments": ""}}]),
        _delta(tool_calls=[{"index": 0, "id": None, "function": {"arguments": '{"city": "K'}}]),
        _delta(tool_calls=[{"index": 0, "function": {"arguments": 'olkata"}'}}]),
        {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
         "usage": {"prompt_tokens": 163, "completion_tokens": 13}},
    ))
    pieces: list[str] = []

    async def on_text(piece: str) -> None:
        pieces.append(piece)

    data = await llm.stream_chat_completion("fast", [{"role": "user", "content": "hi"}], on_text)
    assert sent[0]["stream"] is True
    assert pieces == ["Let me ", "check."]
    message = llm.first_message(data)
    assert message["content"] == "Let me check."
    assert message["tool_calls"] == [{
        "id": "c1", "type": "function",
        "function": {"name": "get_weather", "arguments": '{"city": "Kolkata"}'},
    }]
    assert data["usage"]["completion_tokens"] == 13


def test_tool_labels_read_like_a_person():
    assert loop.tool_label("gmail_search") == "checking your inbox"
    assert loop.tool_label("web_search") == "searching the web"
    assert loop.tool_label("web_open") == "using a website"
    assert loop.tool_label("something_new") == "working on it"


async def test_loop_announces_tools_and_streams_the_answer(monkeypatch):
    steps = iter([
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "1", "type": "function", "function": {"name": "gmail_search",
                                                         "arguments": "{}"}}]},
        {"role": "assistant", "content": "all clear"},
    ])

    async def fake_stream(purpose, messages, on_text, **_):
        message = next(steps)
        if message.get("content"):
            await on_text(message["content"])
        return {"choices": [{"message": message}]}

    class _Tools:
        async def execute(self, name, **kwargs):
            return "nothing new"

        def get_openai_tools(self):
            return [{"type": "function", "function": {"name": "gmail_search"}}]

    monkeypatch.setattr(loop, "stream_chat_completion", fake_stream)
    monkeypatch.setattr(loop, "registry", _Tools())
    events: list[dict] = []

    async def on_event(event: dict) -> None:
        events.append(event)

    reply = await loop.run_agent_loop(
        [{"role": "user", "content": "inbox?"}], "u1", "free", on_event=on_event
    )
    assert reply == "all clear"
    assert events == [
        {"type": "tool", "name": "gmail_search", "label": "checking your inbox"},
        {"type": "text", "text": "all clear"},
    ]


async def test_stream_route_sends_events_and_saves_the_turn(monkeypatch):
    backend = sqlite_backend("alice")

    async def fake_loop(history, user_id, plan, on_event=None, **_):
        await on_event({"type": "tool", "name": "web_search", "label": "searching the web"})
        await on_event({"type": "text", "text": "found "})
        await on_event({"type": "text", "text": "it"})
        return "found it"

    monkeypatch.setattr("yomi.services.agent.loop.run_agent_loop", fake_loop)
    app = FastAPI()
    app.include_router(conversation_router)

    class _User:
        id = "alice"
        plan = "free"

    app.dependency_overrides[get_current_user] = lambda: _User()
    app.dependency_overrides[get_d1_backend] = lambda: backend
    client = TestClient(app)

    res = client.post("/api/conversation/shared/stream", json={"text": "look it up"})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in res.text.splitlines()]
    assert [e["type"] for e in events] == ["tool", "text", "text", "done"]
    assert events[-1]["reply"] == "found it"
    history = await sessions_d1.load_history(backend, "alice", "web", "alice")
    assert [t["content"] for t in history] == ["look it up", "found it"]


async def test_stream_route_reports_errors_in_the_stream(monkeypatch):
    backend = sqlite_backend("alice")

    async def broken(*_, **__):
        raise RuntimeError("model down")

    monkeypatch.setattr("yomi.services.agent.loop.run_agent_loop", broken)
    app = FastAPI()
    app.include_router(conversation_router)

    class _User:
        id = "alice"
        plan = "free"

    app.dependency_overrides[get_current_user] = lambda: _User()
    app.dependency_overrides[get_d1_backend] = lambda: backend
    res = TestClient(app).post("/api/conversation/shared/stream", json={"text": "hi"})
    events = [json.loads(line) for line in res.text.splitlines()]
    assert events == [{"type": "error", "message": "Yomi hit an error; try again"}]
