"""ReplyStream: one Telegram message, edited as the reply is written."""

from __future__ import annotations

from typing import Any

from yomi.gateway.telegram import _markdown_to_telegram_html, _message_chunks
from yomi.gateway.telegram_stream import EDIT_INTERVAL_S, ReplyStream


class FakeTelegram:
    def __init__(self, fail_send: bool = False, reject_html_edit: bool = False) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.fail_send = fail_send
        self.reject_html_edit = reject_html_edit

    async def __call__(self, method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        self.calls.append((method, payload))
        if method == "sendMessage":
            return None if self.fail_send else {"ok": True, "result": {"message_id": 7}}
        if method == "editMessageText" and self.reject_html_edit and "parse_mode" in payload:
            return {"ok": False, "description": "Bad Request: can't parse entities"}
        return {"ok": True, "result": {}}

    def methods(self) -> list[str]:
        return [m for m, _ in self.calls]


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def make(tg: FakeTelegram, clock: Clock | None = None) -> ReplyStream:
    return ReplyStream(
        123, tg, _markdown_to_telegram_html, _message_chunks, clock=clock or Clock()
    )


async def test_first_words_send_a_message_then_edits_follow():
    tg, clock = FakeTelegram(), Clock()
    stream = make(tg, clock)
    await stream.on_event({"type": "text", "text": "sure, here's the plan for tomorrow "})
    assert tg.methods() == ["sendMessage"]
    assert stream.message_id == 7

    clock.now += EDIT_INTERVAL_S + 0.1
    await stream.on_event({"type": "text", "text": "and the meeting moves to 3pm today."})
    assert tg.methods() == ["sendMessage", "editMessageText"]
    assert "3pm" in tg.calls[-1][1]["text"]


async def test_edits_are_throttled():
    tg, clock = FakeTelegram(), Clock()
    stream = make(tg, clock)
    for _ in range(10):
        await stream.on_event({"type": "text", "text": "x" * 30})
    # The first send, then nothing more until a second has passed.
    assert tg.methods() == ["sendMessage"]


async def test_tool_step_shows_status_and_drops_thinking_aloud():
    tg = FakeTelegram()
    stream = make(tg)
    await stream.on_event({"type": "text", "text": "let me look that up in your inbox right now"})
    await stream.on_event({"type": "tool", "name": "gmail_search", "label": "checking your inbox"})
    assert "checking your inbox" in tg.calls[-1][1]["text"]
    assert "let me look" not in tg.calls[-1][1]["text"]


async def test_finish_edits_the_streamed_message_into_the_final_reply():
    tg = FakeTelegram()
    stream = make(tg)
    await stream.on_event({"type": "text", "text": "drafting the reply for you now, one sec"})
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("**done.** tap approve to send it.", send_plain)
    method, payload = tg.calls[-1]
    assert method == "editMessageText"
    assert payload["message_id"] == 7
    assert "<b>done.</b>" in payload["text"]
    assert sent == []


async def test_finish_sends_normally_when_nothing_streamed():
    tg = FakeTelegram()
    stream = make(tg)
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("hi!", send_plain)
    assert sent == ["hi!"]
    assert tg.calls == []


async def test_long_final_reply_edits_first_part_and_sends_the_rest():
    tg = FakeTelegram()
    stream = make(tg)
    await stream.on_event({"type": "text", "text": "here is the full write-up you asked for"})
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("a" * 5000, send_plain)
    assert tg.calls[-1][0] == "editMessageText"
    assert len(sent) == 1 and len(sent[0]) == 5000 - 3900


async def test_failed_first_send_falls_back_to_plain_delivery():
    tg = FakeTelegram(fail_send=True)
    stream = make(tg)
    await stream.on_event({"type": "text", "text": "starting to answer your question here"})
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("the answer", send_plain)
    assert sent == ["the answer"]


async def test_bad_markup_on_final_edit_retries_as_plain_text():
    tg = FakeTelegram(reject_html_edit=True)
    stream = make(tg)
    await stream.on_event({"type": "text", "text": "working through this one for you now"})
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("final <answer>", send_plain)
    method, payload = tg.calls[-1]
    assert method == "editMessageText" and "parse_mode" not in payload
    assert sent == []


async def test_empty_reply_still_resolves_the_message():
    tg = FakeTelegram()
    stream = make(tg)
    sent: list[str] = []

    async def send_plain(text: str) -> None:
        sent.append(text)

    await stream.finish("   ", send_plain)
    assert sent == ["👍"]
