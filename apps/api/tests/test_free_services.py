"""Keyless and key-gated free services: character lookup, geocoding, mail, traces."""

from __future__ import annotations

import json

import pytest

from yomi.services import character_lookup, geocode, llm_trace, mail


class FakeResponse:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


class FakeClient:
    def __init__(self, routes):
        self.routes = routes
        self.calls: list[tuple[str, dict]] = []

    async def get(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.routes[url]

    async def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return self.routes[url]


ANILIST = {"data": {"Page": {"characters": [{
    "name": {"full": "Satoru Gojo"},
    "image": {"large": "https://s4.anilist.co/gojo.png"},
    "description": "__Height:__ 190 cm\nA teacher. ~!He dies.!~ Very [strong](https://x).",
    "siteUrl": "https://anilist.co/character/127691",
    "media": {"nodes": [{"title": {"english": "Jujutsu Kaisen", "romaji": "Jujutsu Kaisen"}}]},
}]}}}
SHOW = {"id": 169, "name": "Breaking Bad", "url": "https://www.tvmaze.com/shows/169"}
CAST = [
    {"person": {"image": {"original": "https://actor.jpg"}},
     "character": {"name": "Walter White", "image": {"original": "https://walt.jpg"}}},
    {"person": {"image": {"original": "https://actor2.jpg"}},
     "character": {"name": "Jesse Pinkman", "image": None}},
]


def _lookup_client(anilist=ANILIST, show=SHOW):
    return FakeClient({
        character_lookup.ANILIST_URL: FakeResponse(anilist),
        f"{character_lookup.TVMAZE_URL}/singlesearch/shows": FakeResponse(show),
        f"{character_lookup.TVMAZE_URL}/shows/169/cast": FakeResponse(CAST),
    })


def test_split_query():
    assert character_lookup.split_query("Gojo (Jujutsu Kaisen)") == ("Gojo", "Jujutsu Kaisen")
    assert character_lookup.split_query("Breaking Bad") == ("Breaking Bad", "")


async def test_lookup_merges_both_sources(monkeypatch):
    client = _lookup_client()
    monkeypatch.setattr(character_lookup, "shared_client", lambda: client)
    results = await character_lookup.lookup("Walter White (Breaking Bad)")
    gojo, walt = results
    assert gojo["basedOn"] == "Satoru Gojo (Jujutsu Kaisen)"
    assert gojo["imageCredit"] == "AniList"
    assert gojo["description"] == "Height: 190 cm A teacher. Very strong."  # no spoilers
    assert walt == {
        "name": "Walter White", "work": "Breaking Bad", "basedOn": "Walter White (Breaking Bad)",
        "description": "", "imageUrl": "https://walt.jpg", "imageCredit": "TVMaze",
        "url": "https://www.tvmaze.com/shows/169", "source": "tvmaze",
    }
    # the show is searched by work, AniList by the character name alone
    assert client.calls[0][1]["json"]["variables"] == {"q": "Walter White"}
    assert client.calls[1][1]["params"] == {"q": "Breaking Bad"}


async def test_tvmaze_never_uses_actor_photos(monkeypatch):
    client = _lookup_client(anilist={"data": {"Page": {"characters": []}}})
    monkeypatch.setattr(character_lookup, "shared_client", lambda: client)
    results = await character_lookup.lookup("Breaking Bad")
    assert [r["imageUrl"] for r in results] == ["https://walt.jpg", ""]


async def test_lookup_survives_a_failing_source(monkeypatch):
    client = _lookup_client(show={})
    client.routes[f"{character_lookup.TVMAZE_URL}/singlesearch/shows"] = FakeResponse({}, 500)
    monkeypatch.setattr(character_lookup, "shared_client", lambda: client)
    assert [r["source"] for r in await character_lookup.lookup("gojo")] == ["anilist"]
    assert await character_lookup.lookup("g") == []


@pytest.fixture
def fresh_geocode(monkeypatch):
    monkeypatch.setattr(geocode, "_cache", {})
    monkeypatch.setattr(geocode, "_MIN_INTERVAL", 0)


async def test_reverse_geocode_names_the_place_and_caches(monkeypatch, fresh_geocode):
    client = FakeClient({geocode.NOMINATIM_URL: FakeResponse({"address": {
        "suburb": "Indiranagar", "city": "Bengaluru", "country": "India", "road": "100 Ft Rd",
    }})})
    monkeypatch.setattr(geocode, "shared_client", lambda: client)
    text = await geocode.describe_location(12.97845, 77.64081)
    assert text == "[shared location: Indiranagar, Bengaluru, India (12.97845, 77.64081)]"
    await geocode.reverse(12.9781, 77.6406)  # same ~100 m cell
    assert len(client.calls) == 1
    assert client.calls[0][1]["headers"]["User-Agent"].startswith("Yomi/")


async def test_reverse_geocode_falls_back_to_coordinates(monkeypatch, fresh_geocode):
    client = FakeClient({geocode.NOMINATIM_URL: FakeResponse({}, 503)})
    monkeypatch.setattr(geocode, "shared_client", lambda: client)
    assert await geocode.describe_location(1.5, 2.5) == "[shared location: 1.50000, 2.50000]"


async def test_mail_is_off_without_a_key_and_skips_placeholders(monkeypatch):
    client = FakeClient({mail.RESEND_URL: FakeResponse({"id": "e1"})})
    monkeypatch.setattr(mail, "shared_client", lambda: client)
    monkeypatch.setattr(mail.settings, "resend_api_key", "")
    assert await mail.send_welcome("a@example.com", "Ada Lovelace") is False
    monkeypatch.setattr(mail.settings, "resend_api_key", "re_test")
    assert await mail.send_welcome("telegram-1@users.getyomi.in", "Ada") is False
    assert await mail.send_welcome("a@example.com", "Ada Lovelace") is True
    sent = client.calls[0][1]["json"]
    assert sent["to"] == ["a@example.com"] and sent["text"].startswith("hi Ada,")
    assert sent["reply_to"] == "contact.arkagarai@gmail.com"


def test_trace_span_carries_metadata_but_no_content_or_raw_user_id():
    request_id = "0f8fad5b-d9cb-469f-a165-70867728950e"
    payload = llm_trace.build_payload(
        request_id=request_id, endpoint="characters.draft", purpose="fast", model="@cf/m",
        latency_ms=420, usage={"prompt_tokens": 10, "completion_tokens": 5},
        error_code="ReadTimeout", user_id="user-123", ended_ns=2_000_000_000,
    )
    span = payload["resourceSpans"][0]["scopeSpans"][0]["spans"][0]
    attrs = {a["key"]: a["value"] for a in span["attributes"]}
    assert span["traceId"] == "0f8fad5bd9cb469fa16570867728950e"
    assert len(span["spanId"]) == 16
    assert (span["startTimeUnixNano"], span["endTimeUnixNano"]) == ("1580000000", "2000000000")
    assert attrs["langfuse.observation.type"] == {"stringValue": "generation"}
    assert attrs["gen_ai.usage.input_tokens"] == {"intValue": "10"}
    assert attrs["langfuse.observation.level"] == {"stringValue": "ERROR"}
    assert span["status"] == {"code": 2, "message": "ReadTimeout"}
    assert "user-123" not in json.dumps(payload)
    assert not any("input.value" in k or "prompt" in k for k in attrs)


@pytest.mark.parametrize(
    ("extra", "expected"),
    [
        ({}, "[shared location: Indiranagar, Bengaluru, India (12.97845, 77.64081)]"),
        (
            {"venue": {"title": "Toit", "address": "298 100 Feet Rd"}},
            "[shared location: Toit, 298 100 Feet Rd (12.97845, 77.64081)]",
        ),
    ],
)
async def test_telegram_location_reaches_the_agent_as_text(monkeypatch, extra, expected):
    from types import SimpleNamespace

    from yomi.gateway import telegram

    seen: dict = {}

    async def fake_resolve(*args, **kwargs):
        return SimpleNamespace(id="alice")

    async def fake_enqueue(update, d1, user, chat_id, message_id, text, **kwargs):
        seen["text"] = text
        return {"status": "queued"}

    async def fake_reverse(lat, lon):
        return "Indiranagar, Bengaluru, India"

    monkeypatch.setattr(telegram, "_resolve_yomi_user", fake_resolve)
    monkeypatch.setattr(telegram, "_metering_user", lambda row: {"id": row.id, "plan": "pro"})
    monkeypatch.setattr(telegram, "_enqueue_telegram_run", fake_enqueue)
    monkeypatch.setattr(geocode, "reverse", fake_reverse)
    update = {"update_id": 1, "message": {
        "message_id": 5, "chat": {"id": 9}, "from": {"id": 9},
        "location": {"latitude": 12.97845, "longitude": 77.64081}, **extra,
    }}
    await telegram._handle_update(update, None, d1=object())
    assert seen["text"] == expected


async def test_tvmaze_ignores_fuzzy_show_matches(monkeypatch):
    client = _lookup_client(
        anilist={"data": {"Page": {"characters": []}}}, show={"id": 169, "name": "Sky Rojo"}
    )
    monkeypatch.setattr(character_lookup, "shared_client", lambda: client)
    assert await character_lookup.lookup("Gojo") == []


def test_name_score_prefers_the_first_name_and_forgives_spelling():
    score = character_lookup.name_score
    assert score("levi ackerman", "Levi") > score("levi ackerman", "Mikasa Ackerman") > 0
    assert score("yuji itadori", "Yuuji Itadori") == 5
    assert score("gojo", "Kento Nanami") == 0


async def test_anilist_retries_word_by_word(monkeypatch):
    calls: list[str] = []

    async def fake_characters(q):
        calls.append(q)
        return {
            "levi": [{"name": {"full": "Levi"}, "media": {"nodes": []}}],
            "ackerman": [{"name": {"full": "Mikasa Ackerman"}, "media": {"nodes": []}}],
        }.get(q, [])

    monkeypatch.setattr(character_lookup, "_anilist_characters", fake_characters)
    results = await character_lookup.search_anilist("Levi Ackerman")
    assert calls == ["Levi Ackerman", "levi", "ackerman"]
    assert [r["name"] for r in results] == ["Levi", "Mikasa Ackerman"]
    calls.clear()
    assert await character_lookup.search_anilist("Nobody") == [] and calls == ["Nobody"]
