"""Importing memories pasted from ChatGPT or Claude."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from d1_sqlite import sqlite_backend

from yomi.app.routes import memory as memory_routes
from yomi.app.routes.memory import ImportIn, memory_import, parse_import
from yomi.services.memory import d1_backend

USER = "alice"

PASTED = """Here's what I remember about you:
- Lives in Kolkata
- Is vegetarian
* Works as a software engineer
1. Prefers short replies
2) is vegetarian
ok
"""


def test_parse_import_cleans_bullets_headings_and_duplicates():
    assert parse_import(PASTED) == [
        "Lives in Kolkata",
        "Is vegetarian",
        "Works as a software engineer",
        "Prefers short replies",
    ]


def test_parse_import_caps_the_number_of_lines():
    text = "\n".join(f"fact number {i}" for i in range(500))
    assert len(parse_import(text)) == memory_routes.MAX_IMPORT_LINES


@pytest.fixture
def backend(monkeypatch):
    real_upsert = d1_backend.upsert

    async def no_embed(*args, **kwargs):
        return None

    async def upsert(backend, user_id, data):
        return await real_upsert(backend, user_id, data, embed=no_embed)

    monkeypatch.setattr(d1_backend, "upsert", upsert)
    return sqlite_backend(USER)


async def test_import_keeps_every_line_as_its_own_memory(backend):
    out = await memory_import(
        ImportIn(text=PASTED, source="chatgpt"), user=SimpleNamespace(id=USER), d1=backend
    )
    assert out == {"imported": 4, "skipped": 0}
    rows = await d1_backend.list_entries(backend, USER, 50)
    # no shared topic, so no line replaced another
    assert sorted(r["content"] for r in rows) == sorted(parse_import(PASTED))
    assert {r["sourceType"] for r in rows} == {"import:chatgpt"}


async def test_import_rejects_text_without_memories(backend):
    res = await memory_import(
        ImportIn(text="ok\n\n- \nhi:", source="claude"), user=SimpleNamespace(id=USER), d1=backend
    )
    assert res.status_code == 400
