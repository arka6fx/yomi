"""Port of apps/backend/src/services/memory/contradiction.test.ts (pure logic, mocked HTTP)."""

from types import SimpleNamespace

from yomi.conf import settings
from yomi.services.memory import contradiction as contradiction_mod
from yomi.services.memory import embeddings as embeddings_mod

MEMORY_EMBEDDING_DIMENSIONS = 1536


class FakeResponse:
    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data or {"data": []}


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


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return [dict(row) for row in self._rows]


class FakeSession:
    def __init__(self, rows=None, fail=False):
        self._rows = rows or []
        self.fail = fail
        self.statements = []

    async def execute(self, stmt, params=None):
        if self.fail:
            raise RuntimeError("query failed")
        self.statements.append((stmt, params or {}))
        return FakeResult(self._rows)


def _row(mid, kind="preference", topic="editor", content="uses vim", summary=None):
    return {
        "id": mid,
        "kind": kind,
        "topic": topic,
        "summary": summary,
        "content": content,
    }


def _embedding_response(embedding):
    return FakeResponse(status_code=200, data={"data": [{"embedding": embedding}]})


def _patch_httpx(monkeypatch):
    monkeypatch.setattr(
        embeddings_mod,
        "httpx",
        SimpleNamespace(AsyncClient=FakeClient, Timeout=lambda t: t),
    )


def _set(monkeypatch, **kwargs):
    for key, value in kwargs.items():
        monkeypatch.setattr(settings, key, value)


def _fake_embeddings(monkeypatch, client):
    _patch_httpx(monkeypatch)
    _set(monkeypatch, openai_api_key="test-key")
    client.responses.append(_embedding_response([0.01] * MEMORY_EMBEDDING_DIMENSIONS))
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)


def _candidates():
    return [_row("m1")]


async def test_fetch_turn_candidates_returns_nearest_active_memories(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    rows = [_row("m1"), _row("m2", kind="fact", topic="commute", content="cycles")]
    session = FakeSession(rows=rows)

    candidates = await contradiction_mod.fetch_turn_candidates(
        session, "u1", "User: vs code now\nAssistant: noted"
    )

    assert [c["id"] for c in candidates] == ["m1", "m2"]
    assert candidates[0]["topic"] == "editor"
    assert candidates[0]["content"] == "uses vim"


async def test_fetch_turn_candidates_embeds_whole_turn(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    session = FakeSession()
    turn = "User: actually vs code now\nAssistant: switching you off vim"

    await contradiction_mod.fetch_turn_candidates(session, "u1", turn)

    assert client.posts[0][1]["json"]["input"] == turn


async def test_fetch_turn_candidates_reads_only_callers_active_latest(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    session = FakeSession()

    await contradiction_mod.fetch_turn_candidates(session, "u1", "User: hi\nAssistant: hello")

    stmt, params = session.statements[0]
    assert "status = 'active'" in stmt.text
    assert "is_latest = true" in stmt.text
    assert params["user_id"] == "u1"


async def test_fetch_turn_candidates_retrieves_limit_by_default(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    session = FakeSession()

    await contradiction_mod.fetch_turn_candidates(session, "u1", "User: hi\nAssistant: hello")

    assert contradiction_mod.TURN_CANDIDATE_LIMIT == 20
    assert session.statements[0][1]["limit"] == contradiction_mod.TURN_CANDIDATE_LIMIT


async def test_fetch_turn_candidates_empty_turn_no_call(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    session = FakeSession()

    assert await contradiction_mod.fetch_turn_candidates(session, "u1", "   ") == []
    assert session.statements == []
    assert client.posts == []


async def test_fetch_turn_candidates_no_api_key_no_call(monkeypatch):
    _patch_httpx(monkeypatch)
    _set(monkeypatch, openai_api_key="")
    client = FakeClient()
    monkeypatch.setattr(embeddings_mod.httpx, "AsyncClient", lambda timeout=None: client)
    session = FakeSession()

    assert await contradiction_mod.fetch_turn_candidates(
        session, "u1", "User: hi\nAssistant: hello"
    ) == []
    assert session.statements == []
    assert client.posts == []


async def test_fetch_turn_candidates_query_failure_empty(monkeypatch):
    client = FakeClient()
    _fake_embeddings(monkeypatch, client)
    session = FakeSession(fail=True)

    assert await contradiction_mod.fetch_turn_candidates(
        session, "u1", "User: hi\nAssistant: hello"
    ) == []


def test_render_turn_candidates_shows_ids_and_topics():
    rendered = contradiction_mod.render_turn_candidates([_row("m1"), _row("m2")])
    assert "m1" in rendered
    assert "editor" in rendered
    assert "uses vim" in rendered
    assert "m2" in rendered


def test_render_turn_candidates_empty_says_none():
    assert "none" in contradiction_mod.render_turn_candidates([])


def test_render_turn_candidates_truncates_long_body():
    long_row = _row("m1", topic="t", content="x" * 500)
    rendered = contradiction_mod.render_turn_candidates([long_row])
    assert "x" * contradiction_mod.CANDIDATE_CONTENT_CHARS in rendered
    assert "x" * (contradiction_mod.CANDIDATE_CONTENT_CHARS + 1) not in rendered


def test_build_extraction_prompt_shows_candidates_and_replaces_id():
    prompt = contradiction_mod.build_extraction_prompt(
        "actually vs code now", "noted, vs code it is", [_row("m1")]
    )
    assert "id=m1" in prompt
    assert "replaces_id" in prompt
    assert "actually vs code now" in prompt
    assert "noted, vs code it is" in prompt


def test_build_extraction_prompt_carries_distinctions():
    prompt = contradiction_mod.build_extraction_prompt("hi", "hello", [])
    assert "contradiction" in prompt
    assert "duplicate" in prompt
    assert "elaboration" in prompt
    assert "replaces_topic" not in prompt


def test_build_extraction_prompt_static_identity_rule():
    prompt = contradiction_mod.build_extraction_prompt("hi", "hello", [])
    assert "is_static" in prompt
    assert "identity" in prompt
    assert "standing" in prompt


def test_parse_extracted_memories_reads_list():
    parsed = contradiction_mod.parse_extracted_memories(
        '{"memories":[{"topic":"editor","content":"uses vs code","replaces_id":"m1"}]}'
    )
    assert parsed == [{"topic": "editor", "content": "uses vs code", "replaces_id": "m1"}]


def test_parse_extracted_memories_rejects_wrong_shapes():
    assert contradiction_mod.parse_extracted_memories("sorry, I can't") == []
    assert contradiction_mod.parse_extracted_memories('{"notes":[]}') == []
    assert contradiction_mod.parse_extracted_memories("[1,2]") == []


def test_pick_replaces_id_accepts_shown_id():
    assert contradiction_mod.pick_replaces_id("m1", _candidates()) == "m1"


def test_pick_replaces_id_rejects_unseen_id():
    assert contradiction_mod.pick_replaces_id("m9", _candidates()) is None


def test_pick_replaces_id_rejects_missing_or_non_string():
    assert contradiction_mod.pick_replaces_id(None, _candidates()) is None
    assert contradiction_mod.pick_replaces_id("", _candidates()) is None
    assert contradiction_mod.pick_replaces_id(42, _candidates()) is None


def test_resolve_is_static_true():
    assert contradiction_mod.resolve_is_static({"is_static": True}) is True


def test_resolve_is_static_false_judgment():
    assert contradiction_mod.resolve_is_static({"kind": "preference", "is_static": False}) is False


def test_resolve_is_static_not_inferred_from_kind():
    assert contradiction_mod.resolve_is_static({"kind": "preference"}) is False
    assert contradiction_mod.resolve_is_static({"kind": "fact"}) is False


def test_resolve_is_static_missing_or_malformed():
    assert contradiction_mod.resolve_is_static({}) is False
    assert contradiction_mod.resolve_is_static({"is_static": "true"}) is False
    assert contradiction_mod.resolve_is_static({"is_static": 1}) is False