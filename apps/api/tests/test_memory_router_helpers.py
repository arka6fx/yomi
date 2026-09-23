"""Pure-logic helpers from the memory router port (apps/api/src/routes/memory.ts)."""

from yomi.app.routes.memory import (
    _clamp_confidence,
    _clamp_limit,
    _clean,
    _forget_after_date,
    _from_api_body,
    _hash,
    _normalize_topic,
    relation_for_memory,
)


def test_clean_redacts_embedded_images_and_base64():
    out = _clean('data:image/png;base64,' + "A" * 900, 2000)
    assert "[redacted image]" in out
    assert "base64," not in out


def test_clean_redacts_long_base64_runs():
    blob = "".join("A" * 400 for _ in range(4))
    assert "[redacted base64]" in _clean(blob, 4000)


def test_clean_collapses_newline_runs():
    assert _clean("a\n\n\n\n\nb", 200) == "a\n\nb"


def test_clean_trims_to_length():
    out = _clean("hello world " * 100, 100)
    assert len(out) == 100


def test_clean_strips_carriage_returns():
    assert _clean("a\r\nb", 100) == "a\nb"


def test_hash_is_sha256_hex():
    assert len(_hash("vim")) == 64
    assert _hash("vim") == _hash("vim")
    assert _hash("vim") != _hash("neovim")


def test_clamp_limit_defaults():
    assert _clamp_limit(None, 50, 200) == 50
    assert _clamp_limit("0", 50, 200) == 50
    assert _clamp_limit("not-a-number", 50, 200) == 50


def test_clamp_limit_caps_at_max():
    assert _clamp_limit("300", 50, 200) == 200
    assert _clamp_limit("5", 50, 200) == 5


def test_clamp_confidence_range():
    assert _clamp_confidence(None) == 70
    assert _clamp_confidence("150") == 100
    assert _clamp_confidence("-10") == 0
    assert _clamp_confidence("42") == 42
    assert _clamp_confidence("nope") == 70


def test_forget_after_date_parses_and_ignores_invalid():
    out = _forget_after_date("2026-07-04T12:00:00Z")
    assert out is not None and out.tzinfo is not None
    assert _forget_after_date(None) is None
    assert _forget_after_date("not-a-date") is None


def test_from_api_body_strips_turn_only_fields():
    body = {"content": "x", "replacesId": "abc", "modelJudged": True}
    assert _from_api_body(body) == {"content": "x"}


def test_normalize_topic():
    assert _normalize_topic("  Git & GitHub  ") == "git github"


def test_relation_for_memory_topic_equality():
    assert relation_for_memory({"topic": "GitHub"}, {"topic": " github "}) == "updates"
    assert relation_for_memory({"summary": "neovim"}, {"topic": "neovim"}) == "updates"
    assert relation_for_memory({"topic": "vim"}, {"topic": "neovim"}) is None
    assert relation_for_memory({}, {"topic": "anything"}) is None