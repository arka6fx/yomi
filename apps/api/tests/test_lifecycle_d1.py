"""Onboarding and win-back nudges: right step, right channel, once, and never after stop."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from d1_sqlite import sqlite_backend

from yomi.services import lifecycle_d1, mail

NOW = datetime(2026, 9, 27, 6, 0, tzinfo=UTC)  # 11:30 in Asia/Kolkata


def _age(db, user_id: str, days: float) -> None:
    db.store.db.execute(
        'UPDATE "user" SET created_at = ? WHERE id = ?',
        [(NOW - timedelta(days=days)).isoformat(), user_id],
    )


@pytest.fixture
def db(monkeypatch):
    backend = sqlite_backend("tg", "mailer")
    backend.store.db.execute(
        "INSERT INTO platform_connections (user_id, platform, platform_user_id, platform_chat_id) "
        "VALUES ('tg', 'telegram', '42', '42')"
    )
    _age(backend, "tg", 2)
    _age(backend, "mailer", 2)
    telegram: list[tuple[str, str]] = []
    emails: list[dict] = []

    async def fake_telegram(chat_id, text):
        telegram.append((str(chat_id), text))

    async def fake_email(to, subject, text, html=None, unsubscribe_url=None):
        emails.append({"to": to, "subject": subject, "text": text, "html": html,
                       "unsubscribe": unsubscribe_url})
        return True

    monkeypatch.setattr("yomi.gateway.telegram.send_message", fake_telegram)
    monkeypatch.setattr(mail, "send_email", fake_email)
    monkeypatch.setattr(mail, "enabled", lambda: True)
    monkeypatch.setattr(lifecycle_d1.settings, "better_auth_secret", "s" * 32)
    backend.telegram = telegram  # type: ignore[attr-defined]
    backend.emails = emails  # type: ignore[attr-defined]
    return backend


def _steps(db, user_id: str) -> dict[str, str]:
    rows = db.store.db.execute(
        "SELECT step, channel FROM lifecycle_messages WHERE user_id = ?", [user_id]
    ).fetchall()
    return {row["step"]: row["channel"] for row in rows}


async def test_first_nudge_goes_to_telegram_when_linked_and_email_otherwise(db):
    assert await lifecycle_d1.send_due(db, NOW) == 2
    [(chat, text)] = db.telegram
    assert chat == "42" and "connect Gmail" in text and "/stoptips" in text
    [email] = db.emails
    assert email["to"] == "mailer@example.com"
    assert "unsubscribe" in email["html"] and email["unsubscribe"] in email["text"]
    assert _steps(db, "tg") == {"connect_apps": "telegram"}
    assert _steps(db, "mailer") == {"connect_apps": "email"}


async def test_one_nudge_a_day_and_each_step_once(db):
    _age(db, "tg", 4)
    await lifecycle_d1.send_due(db, NOW)
    assert await lifecycle_d1.send_due(db, NOW + timedelta(hours=2)) == 0
    await lifecycle_d1.send_due(db, NOW + timedelta(days=1))
    texts = [text for chat, text in db.telegram]
    assert len(texts) == 2 and "every morning at 8" in texts[1]
    assert await lifecycle_d1.send_due(db, NOW + timedelta(days=2)) == 0  # day 6: nothing due


async def test_steps_that_no_longer_apply_are_skipped(db):
    _age(db, "tg", 4)
    db.store.db.execute(
        "INSERT INTO mcp_connections (user_id, provider, oauth_tokens, scopes) "
        "VALUES ('tg', 'gmail', '{}', '[]')"
    )
    await lifecycle_d1.send_due(db, NOW)
    assert _steps(db, "tg") == {"connect_apps": "skipped", "try_routine": "telegram"}


async def test_come_back_only_after_quiet_days(db):
    _age(db, "tg", 8)
    for step in ("connect_apps", "try_routine"):
        db.store.db.execute(
            "INSERT INTO lifecycle_messages VALUES ('tg', ?, 'telegram', ?)",
            [step, (NOW - timedelta(days=3)).isoformat()],
        )
    db.store.db.execute(
        "INSERT INTO usage_events (user_id, kind, created_at) VALUES ('tg', 'chat', ?)",
        [(NOW - timedelta(days=1)).isoformat()],
    )
    await lifecycle_d1.send_due(db, NOW)
    assert _steps(db, "tg")["come_back"] == "skipped"  # they're active: leave them be


async def test_nothing_at_night_or_for_old_accounts(db):
    assert await lifecycle_d1.send_due(db, NOW.replace(hour=18)) == 0  # 23:30 in India
    _age(db, "tg", 90)
    _age(db, "mailer", 90)
    assert await lifecycle_d1.send_due(db, NOW) == 0


async def test_stop_means_stop(db):
    await lifecycle_d1.opt_out(db, "tg")
    token = lifecycle_d1.unsubscribe_token("mailer")
    assert lifecycle_d1.valid_unsubscribe("mailer", token)
    assert not lifecycle_d1.valid_unsubscribe("tg", token)
    await lifecycle_d1.opt_out(db, "mailer")
    assert await lifecycle_d1.send_due(db, NOW) == 0
    assert db.telegram == [] and db.emails == []


def test_welcome_email_is_escaped_and_has_a_text_version():
    text, html = mail.render("hi <b>,", ["one & two"], cta=("go", "https://x.y/?a=1&b=2"))
    assert "hi <b>," in text and "https://x.y/?a=1&b=2" in text
    assert "hi &lt;b&gt;," in html and "one &amp; two" in html and "a=1&amp;b=2" in html
    assert mail.first_name("Arka Garai") == "Arka" and mail.first_name("a@b.c") == "there"
