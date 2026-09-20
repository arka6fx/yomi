from yomi.shared.text import DEFAULT_AGENT_SOUL, format_agent_soul, humanize_dashes


def test_soul_starts_voice_line():
    assert DEFAULT_AGENT_SOUL.startswith("You are Yomi: sharp, warm, and practical.")


def test_soul_joined_with_newlines():
    assert "\n" in DEFAULT_AGENT_SOUL


def test_format_agent_soul_wraps():
    assert format_agent_soul("Be brief.") == "<agent_soul>\nBe brief.\n</agent_soul>"


def test_format_agent_soul_uses_default_when_empty():
    wrapped = format_agent_soul(None)
    assert wrapped.startswith("<agent_soul>\n")
    assert DEFAULT_AGENT_SOUL in wrapped


def test_format_agent_soul_empty_string_defaults():
    # TS: soul?.trim() || DEFAULT_AGENT_SOUL — whitespace falls back to the default.
    assert DEFAULT_AGENT_SOUL in format_agent_soul("   ")
    assert DEFAULT_AGENT_SOUL in format_agent_soul("")


def test_humanize_dashes_em_en_only():
    assert humanize_dashes("a — b") == "a, b"
    assert humanize_dashes("a —b") == "a, b"
    assert humanize_dashes("a —  b") == "a, b"
    assert humanize_dashes("a – b") == "a, b"
    # hyphen-minus untouched (markdown bullets, "->", code)
    assert humanize_dashes("- item") == "- item"
    assert humanize_dashes("a - b") == "a - b"
    assert humanize_dashes("->") == "->"


def test_humanize_dashes_idempotent():
    text = "first — second – third"
    once = humanize_dashes(text)
    assert humanize_dashes(once) == once
    assert "--" not in once and "–" not in once and "—" not in once