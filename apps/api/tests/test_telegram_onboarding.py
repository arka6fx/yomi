"""Texting the bot is signing up: new people never see a code or a settings page."""

from __future__ import annotations

from d1_sqlite import sqlite_backend


async def test_first_message_creates_an_account_and_gets_answered(monkeypatch):
    from yomi.gateway import telegram
    from yomi.services import connectors_d1

    backend = sqlite_backend()
    sent: list[str] = []
    queued: list[str] = []

    async def fake_send(chat_id, text):
        sent.append(text)

    async def fake_enqueue(update, d1, user, chat_id, message_id, text, **kwargs):
        queued.append(text)
        return {"status": "queued"}

    monkeypatch.setattr(telegram, "send_message", fake_send)
    monkeypatch.setattr(telegram, "_enqueue_telegram_run", fake_enqueue)
    update = {"update_id": 1, "message": {
        "message_id": 1, "chat": {"id": 42, "type": "private"},
        "from": {"id": 42, "first_name": "Riya"}, "text": "hey, what can you do?",
    }}
    assert await telegram._handle_update(update, None, backend) == {"status": "queued"}
    assert "Welcome to Yomi" in sent[0] and queued == ["hey, what can you do?"]
    assert await connectors_d1.resolve_platform_user(backend, "telegram", "42", "42")

    # The second message goes straight through: no second welcome.
    sent.clear()
    update["message"]["text"] = "remind me at 6"
    await telegram._handle_update(update, None, backend)
    assert sent == [] and queued[-1] == "remind me at 6"


async def test_start_welcomes_new_and_returning_people(monkeypatch):
    from yomi.gateway import telegram

    backend = sqlite_backend()
    sent: list[str] = []

    async def fake_send(chat_id, text):
        sent.append(text)

    monkeypatch.setattr(telegram, "send_message", fake_send)
    start = {"update_id": 2, "message": {
        "message_id": 2, "chat": {"id": 7, "type": "private"}, "from": {"id": 7},
        "text": "/start",
    }}
    await telegram._handle_update(start, None, backend)
    await telegram._handle_update(start, None, backend)
    assert "no sign-up needed" in sent[0] and "welcome back" in sent[1]
    assert not any("code" in text for text in sent)
