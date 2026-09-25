"""Memory graph over the real SQLite D1 schema."""

from __future__ import annotations

from d1_sqlite import sqlite_backend

from yomi.services.memory import d1_backend


async def test_graph_returns_active_nodes_and_edges_between_them():
    backend = sqlite_backend("alice")
    db = backend.store.db
    for mid, status, latest, content in (
        ("m1", "active", 1, "Lives in Kolkata"),
        ("m2", "active", 1, "Works at Yomi"),
        ("m3", "superseded", 0, "Lived in Delhi"),
    ):
        db.execute(
            "INSERT INTO memory_entries (id, user_id, kind, scope, topic, content, "
            "content_hash, status, is_latest, is_static) "
            "VALUES (?, 'alice', 'fact', 'global', 'home', ?, ?, ?, ?, 0)",
            [mid, content, mid, status, latest],
        )
    db.execute(
        "INSERT INTO memory_relations (user_id, from_memory_id, to_memory_id, relation_type) "
        "VALUES ('alice', 'm1', 'm2', 'related')"
    )
    db.execute(
        "INSERT INTO memory_relations (user_id, from_memory_id, to_memory_id, relation_type) "
        "VALUES ('alice', 'm1', 'm3', 'updates')"
    )
    graph = await d1_backend.graph(backend, "alice", 50)
    assert {n["id"] for n in graph["nodes"]} == {"m1", "m2"}
    assert graph["edges"] == [{"from": "m1", "to": "m2", "type": "related"}]
    assert next(n for n in graph["nodes"] if n["id"] == "m1")["label"] == "Lives in Kolkata"
