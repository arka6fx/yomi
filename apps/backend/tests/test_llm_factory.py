"""Tests for the Workers AI chat factory, tool-result formatting, STT, and RAG embeddings."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from yomi.conf import settings
from yomi.services import llm as llm_mod
from yomi.services.agent.loop import format_tool_result
from yomi.services.rag import embeddings as rag_embeddings


def _set(monkeypatch, **kwargs):
    for key, value in kwargs.items():
        monkeypatch.setattr(settings, key, value)


def _creds(monkeypatch, account="acct-1", token="tok-1"):
    _set(monkeypatch, cloudflare_account_id=account, cloudflare_api_token=token)


class TestChatConfig:
    def test_workers_ai_endpoint_and_models(self, monkeypatch):
        _creds(monkeypatch)
        _set(monkeypatch, workers_ai_agent_model="@cf/qwen/qwen3.8-27b")
        url, token, _ = llm_mod.chat_endpoint()
        assert url == "https://api.cloudflare.com/client/v4/accounts/acct-1/ai/v1/chat/completions"
        assert token == "tok-1"
        assert llm_mod.model_for("agent") == "@cf/qwen/qwen3.8-27b"

    def test_purpose_mapping(self, monkeypatch):
        _creds(monkeypatch)
        _set(
            monkeypatch,
            workers_ai_fast_model="@cf/fast",
            workers_ai_agent_model="@cf/agent",
            workers_ai_search_model="@cf/search",
        )
        assert llm_mod.model_for("fast") == "@cf/fast"
        assert llm_mod.model_for("agent") == "@cf/agent"
        assert llm_mod.model_for("search") == "@cf/search"

    def test_missing_credentials_raise(self, monkeypatch):
        _set(monkeypatch, cloudflare_account_id="", cloudflare_api_token="")
        with pytest.raises(RuntimeError, match="not configured"):
            llm_mod.chat_endpoint()

    async def test_completion_without_credentials_raise(self, monkeypatch):
        _set(monkeypatch, cloudflare_account_id="", cloudflare_api_token="")
        with pytest.raises(RuntimeError, match="not configured"):
            await llm_mod.chat_completion("fast", [{"role": "user", "content": "hi"}])

    def test_no_openai_settings_remain(self):
        assert not hasattr(settings, "openai_api_key")
        assert not hasattr(settings, "openai_fast_model")


class FakeResponse:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data or {}

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            import httpx

            raise httpx.HTTPStatusError("bad", request=None, response=None)


class FakeClient:
    def __init__(self, timeout=None):
        self.posts: list[tuple[str, dict]] = []
        self.response = FakeResponse(200, {"choices": [{"message": {"content": "hi"}}]})

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return self.response


def _patch_httpx(monkeypatch, module, client=None):
    client = client or FakeClient()
    monkeypatch.setattr(
        module, "httpx",
        SimpleNamespace(AsyncClient=lambda timeout=None: client, Timeout=lambda t: t),
    )
    return client


class TestChatCompletion:
    async def test_posts_model_and_messages(self, monkeypatch):
        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, llm_mod)
        data = await llm_mod.chat_completion("fast", [{"role": "user", "content": "hi"}])
        assert llm_mod.first_message(data) == {"content": "hi"}
        url, payload = client.posts[0][0], client.posts[0][1]["json"]
        assert url.endswith("/ai/v1/chat/completions")
        assert payload["model"] == "@cf/qwen/qwen3.8-27b"
        assert payload["messages"] == [{"role": "user", "content": "hi"}]
        assert "tools" not in payload

    async def test_tools_forwarded(self, monkeypatch):
        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, llm_mod)
        tools = [{"type": "function", "function": {"name": "t", "parameters": {}}}]
        await llm_mod.chat_completion("agent", [], tools=tools)
        assert client.posts[0][1]["json"]["tools"] == tools

    async def test_malformed_reply_raises(self):
        with pytest.raises(RuntimeError, match="Malformed"):
            llm_mod.first_message({})
        with pytest.raises(RuntimeError, match="Malformed"):
            llm_mod.first_message({"choices": []})


class TestFormatToolResult:
    def test_text_result(self):
        assert format_tool_result("c1", "hello") == {
            "role": "tool", "tool_call_id": "c1", "content": "hello"}

    def test_error_result(self):
        assert format_tool_result("c1", "Error: x")["content"] == "Error: x"

    def test_image_result_parts(self):
        msg = format_tool_result("c2", {"text": "see it", "images": [b"\x89PNG"]})
        assert msg["role"] == "tool" and msg["tool_call_id"] == "c2"
        text, image = msg["content"]
        assert text == {"type": "text", "text": "see it"}
        assert image["type"] == "image_url"
        assert image["image_url"]["url"].startswith("data:image/png;base64,")

    def test_empty_images_fall_back_to_text(self):
        msg = format_tool_result("c3", {"text": "nothing", "images": []})
        assert isinstance(msg["content"], list)


class TestRagEmbeddings:
    async def test_embed_text_posts_workers_ai(self, monkeypatch):
        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, rag_embeddings)
        client.response = FakeResponse(200, {"result": {"data": [[0.5] * 768]}})
        result = await rag_embeddings.embed_text("hello")
        assert result == [0.5] * 768
        assert client.posts[0][0].endswith("/ai/run/@cf/baai/bge-base-en-v1.5")
        assert client.posts[0][1]["json"] == {"text": "hello"}

    async def test_embed_text_rejects_wrong_dims(self, monkeypatch):
        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, rag_embeddings)
        client.response = FakeResponse(200, {"result": {"data": [[0.5] * 1536]}})
        with pytest.raises(RuntimeError, match="768"):
            await rag_embeddings.embed_text("hello")


class TestTranscription:
    async def test_transcribe_posts_audio_ints(self, monkeypatch):
        from yomi.services import transcription as transcription_mod

        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, transcription_mod)
        client.response = FakeResponse(200, {"result": {"text": "  hello there  "}})
        assert await transcription_mod.transcribe_audio(b"\x00\x01", "audio/ogg") == "hello there"
        url, kwargs = client.posts[0]
        assert url.endswith("/ai/run/@cf/openai/whisper")
        assert kwargs["json"] == {"audio": [0, 1]}

    async def test_transcribe_empty_transcript_raises(self, monkeypatch):
        from yomi.services import transcription as transcription_mod

        _creds(monkeypatch)
        client = _patch_httpx(monkeypatch, transcription_mod)
        client.response = FakeResponse(200, {"result": {"text": "   "}})
        with pytest.raises(RuntimeError, match="empty transcript"):
            await transcription_mod.transcribe_audio(b"\x00")


class TestComputerRegistration:
    def test_registered_only_when_configured(self, monkeypatch):
        from yomi.services.agent.tools import ToolRegistry, register_computer_tools

        _set(monkeypatch, computer_gateway_url="", computer_gateway_secret="")
        from yomi.services.agent import tools as tools_mod

        assert tools_mod.computer_configured() is False
        _set(
            monkeypatch,
            computer_gateway_url="https://computer.example.test",
            computer_gateway_secret="s" * 32,
        )
        assert tools_mod.computer_configured() is True
        registry = ToolRegistry()
        register_computer_tools(registry, "u-1")
        names = {tool["function"]["name"] for tool in registry.get_openai_tools()}
        assert names == {
            "computer_screenshot", "computer_input", "computer_open", "computer_windows",
        }
