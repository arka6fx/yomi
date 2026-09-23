"""Memory embeddings via Workers AI (mocked HTTP)."""

from types import SimpleNamespace

from yomi.conf import settings
from yomi.services.memory import embeddings as embeddings_mod


class FakeResponse:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data or {"result": {}}


class FakeClient:
    def __init__(self, timeout=None):
        self.timeout = timeout
        self.posts: list[tuple[str, dict]] = []
        self.responses: list[SimpleNamespace] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return self.responses.pop(0) if self.responses else FakeResponse(status_code=500)


def _embedding_response(embedding: list[float]) -> FakeResponse:
    return FakeResponse(status_code=200, data={"result": {"data": [embedding]}})


def _patch_httpx(monkeypatch):
    monkeypatch.setattr(
        embeddings_mod,
        "httpx",
        SimpleNamespace(AsyncClient=FakeClient, Timeout=lambda t: t),
    )


def _set(monkeypatch, **kwargs):
    for key, value in kwargs.items():
        monkeypatch.setattr(settings, key, value)


def _creds(monkeypatch):
    _set(monkeypatch, cloudflare_account_id="acct-1", cloudflare_api_token="tok-1")


def test_memory_embedding_model_defaults(monkeypatch):
    _set(monkeypatch, workers_ai_embedding_model="@cf/baai/bge-base-en-v1.5")
    assert embeddings_mod.memory_embedding_model() == "@cf/baai/bge-base-en-v1.5"


def test_memory_embedding_model_honours_override(monkeypatch):
    _set(monkeypatch, workers_ai_embedding_model="@cf/baai/bge-large-en-v1.5")
    assert embeddings_mod.memory_embedding_model() == "@cf/baai/bge-large-en-v1.5"


async def test_embed_memory_text_returns_embedding(monkeypatch):
    _patch_httpx(monkeypatch)
    _creds(monkeypatch)
    client = FakeClient()
    embedding = [i / 10000 for i in range(768)]
    client.responses.append(_embedding_response(embedding))
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    result = await embeddings_mod.embed_memory_text("remember this")
    assert result == embedding


async def test_embed_memory_text_posts_resolved_model_and_url(monkeypatch):
    _patch_httpx(monkeypatch)
    _creds(monkeypatch)
    _set(monkeypatch, workers_ai_embedding_model="@cf/baai/bge-large-en-v1.5")
    client = FakeClient()
    client.responses.append(_embedding_response([0.1] * 768))
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    await embeddings_mod.embed_memory_text("remember this")

    assert client.posts[0][0] == (
        "https://api.cloudflare.com/client/v4/accounts/acct-1/ai/run/"
        "@cf/baai/bge-large-en-v1.5"
    )
    assert client.posts[0][1]["json"] == {"text": "remember this"}


async def test_embed_memory_text_blank_input_no_call(monkeypatch):
    _patch_httpx(monkeypatch)
    _creds(monkeypatch)
    client = FakeClient()
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    result = await embeddings_mod.embed_memory_text("   ")
    assert result == []
    assert client.posts == []


async def test_embed_memory_text_no_credentials_no_call(monkeypatch):
    _patch_httpx(monkeypatch)
    _set(monkeypatch, cloudflare_account_id="", cloudflare_api_token="")
    client = FakeClient()
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    result = await embeddings_mod.embed_memory_text("remember this")
    assert result == []
    assert client.posts == []


async def test_embed_memory_text_error_response(monkeypatch):
    _patch_httpx(monkeypatch)
    _creds(monkeypatch)
    client = FakeClient()
    client.responses.append(FakeResponse(status_code=500))
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    assert await embeddings_mod.embed_memory_text("remember this") == []


async def test_embed_memory_text_wrong_dimensions(monkeypatch):
    _patch_httpx(monkeypatch)
    _creds(monkeypatch)
    client = FakeClient()
    client.responses.append(_embedding_response([0.1] * 1536))
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)

    assert await embeddings_mod.embed_memory_text("remember this") == []


def test_memory_vector_literal_formats_8_decimals():
    out = embeddings_mod.memory_vector_literal([1, -0.5, 0.123456789])
    assert out == "[1.00000000,-0.50000000,0.12345679]"


def test_memory_vector_literal_non_finite_as_zero():
    assert embeddings_mod.memory_vector_literal([float("nan"), float("inf")]) == "[0,0]"


def test_memory_vector_literal_empty():
    assert embeddings_mod.memory_vector_literal([]) == "[]"


def test_embeddings_dimensions_constant():
    assert embeddings_mod.MEMORY_EMBEDDING_DIMENSIONS == 768
