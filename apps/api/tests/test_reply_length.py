"""Replies stay short, and old long turns don't bloat every request."""

from __future__ import annotations

from yomi.services.agent import loop


async def test_system_prompt_always_carries_the_length_rules():
    prompt = await loop._system_prompt(None, None, "user-1")
    assert "<reply_length>" in prompt
    assert "1 to 3 short" in prompt
    # The length rules come before the long operating style, so they aren't buried.
    assert prompt.index("<reply_length>") < prompt.index("<yomi_operating_style>")


def test_old_long_turns_are_clipped_but_recent_ones_stay_whole():
    long = "x" * 5000
    turns = [{"role": "assistant", "content": long}] + [
        {"role": "user", "content": long} for _ in range(loop.KEEP_WHOLE)
    ]
    clipped = loop.clip_old_turns(turns)
    assert clipped[0]["content"].endswith("(trimmed)")
    assert len(clipped[0]["content"]) < loop.OLD_TURN_CHARS + 20
    assert all(t["content"] == long for t in clipped[1:])


def test_short_turns_and_non_text_content_are_untouched():
    turns = [
        {"role": "user", "content": "hi"},
        {"role": "user", "content": [{"type": "text", "text": "y" * 5000}]},
    ] + [{"role": "user", "content": "ok"} for _ in range(loop.KEEP_WHOLE)]
    assert loop.clip_old_turns(turns) == turns


def test_clipping_does_not_mutate_the_saved_history():
    original = {"role": "assistant", "content": "z" * 5000}
    loop.clip_old_turns([original] + [{"role": "user", "content": "a"}] * loop.KEEP_WHOLE)
    assert len(original["content"]) == 5000
