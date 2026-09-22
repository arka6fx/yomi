"""Behavioral tests for the D1 RAG backend over an in-memory fake."""

from __future__ import annotations

import re
from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.store import D1Store
from yomi.services.rag import d1_backend
from yomi.services.rag.index_document import IndexDocumentInput


class FakeRag(D1Store):
    def __init__(self) -> None:
        self.tables: dict[str, list[dict]] = {
            "rag_sources": [],
            "rag_documents": [],
            "rag_chunks": [],
            "rag_retrieval_logs": [],
            "vector_sync_outbox": [],
        }

    def _insert(self, stmt: Statement) -> dict:
        match = re.match(r'INSERT (?:OR \w+ )?INTO "(\w+)" \((.+)\) VALUES', stmt.sql)
        assert match, stmt.sql
        cols = [c.strip().strip('"') for c in match.group(2).split(",")]
        self.tables[match.group(1)].append(dict(zip(cols, stmt.params, strict=True)))
        return {"success": True}

    def _docs_of(self, source_id: str) -> list[dict]:
        return [d for d in self.tables["rag_documents"] if d["source_id"] == source_id]

    def _chunk_live(self, chunk: dict) -> tuple[dict | None, dict | None]:
        doc = next(
            (d for d in self.tables["rag_documents"] if d["id"] == chunk["document_id"]),
            None,
        )
        source = self._source_of(doc) if doc else None
        if not doc or not source or source["status"] not in ("ready", "active", "backfilling"):
            return None, None
        return doc, source

    def _source_of(self, doc: dict) -> dict | None:
        return next(
            (s for s in self.tables["rag_sources"] if s["id"] == doc["source_id"]), None
        )

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        out = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("INSERT"):
                out.append(self._insert(stmt))
            elif sql.startswith("UPDATE rag_sources SET status = 'deleted'"):
                for row in self.tables["rag_sources"]:
                    if row["id"] == stmt.params[-1]:
                        row.update(status="deleted", updated_at=stmt.params[0])
                out.append({"success": True})
            elif sql.startswith("UPDATE rag_sources SET name"):
                row = next(r for r in self.tables["rag_sources"] if r["id"] == stmt.params[-1])
                row.update(
                    name=stmt.params[0], path=stmt.params[1], content_hash=stmt.params[2],
                    source_type=stmt.params[3], status="ready", updated_at=stmt.params[4],
                )
                out.append({"success": True})
            elif sql.startswith("UPDATE rag_documents SET title"):
                row = next(r for r in self.tables["rag_documents"] if r["id"] == stmt.params[-1])
                row.update(title=stmt.params[0], metadata=stmt.params[1], updated_at=stmt.params[2])
                out.append({"success": True})
            elif sql.startswith("DELETE FROM rag_documents"):
                self.tables["rag_documents"] = [
                    r for r in self.tables["rag_documents"] if r["id"] != stmt.params[0]
                ]
                self.tables["rag_chunks"] = [
                    r for r in self.tables["rag_chunks"] if r["document_id"] != stmt.params[0]
                ]
                out.append({"success": True})
            elif sql.startswith("DELETE FROM rag_chunks"):
                self.tables["rag_chunks"] = [
                    r for r in self.tables["rag_chunks"] if r["document_id"] != stmt.params[0]
                ]
                out.append({"success": True})
            else:
                raise AssertionError(f"unsupported: {sql}")
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        if "COUNT(DISTINCT d.id)" in sql:
            out = []
            for source in self.tables["rag_sources"]:
                if source["user_id"] != p[0] or source["status"] == "deleted":
                    continue
                docs = self._docs_of(str(source["id"]))
                chunks = [
                    c for c in self.tables["rag_chunks"]
                    if c["document_id"] in {str(d["id"]) for d in docs}
                ]
                out.append({
                    "id": source["id"], "name": source["name"], "path": source["path"],
                    "contentHash": source["content_hash"], "sourceType": source["source_type"],
                    "status": source["status"], "documentCount": len(docs),
                    "chunkCount": len(chunks), "createdAt": source["created_at"],
                    "updatedAt": source["updated_at"],
                })
            return out
        if "FROM rag_chunks c" in sql and "c.id AS id" in sql:
            words = [str(x).strip("%").lower() for x in p[1:-1]]
            limit = int(p[-1])
            ids = []
            for chunk in self.tables["rag_chunks"]:
                if chunk["user_id"] != p[0]:
                    continue
                doc, source = self._chunk_live(chunk)
                if doc is None or source is None:
                    continue
                if any(w in str(chunk["content"]).lower() for w in words):
                    ids.append({"id": chunk["id"]})
            return ids[:limit]
        if "FROM rag_chunks c" in sql:
            wanted = set(p[1:])
            rows = []
            for chunk in self.tables["rag_chunks"]:
                if chunk["user_id"] != p[0] or chunk["id"] not in wanted:
                    continue
                doc, source = self._chunk_live(chunk)
                if doc is None or source is None:
                    continue
                rows.append({
                    "chunkId": chunk["id"], "content": chunk["content"],
                    "documentId": doc["id"], "sourceId": source["id"],
                    "sourceName": source["name"], "title": doc["title"],
                })
            return rows
        if "FROM rag_sources" in sql:
            if "WHERE id = ?" in sql:
                return [
                    r for r in self.tables["rag_sources"]
                    if r["id"] == p[0] and r["user_id"] == p[1]
                ]
            return [
                r for r in self.tables["rag_sources"]
                if r["user_id"] == p[0] and (len(p) < 2 or r.get("path") == p[1])
                and (len(p) < 3 or r.get("source_type") == p[2])
            ]
        if "FROM rag_documents" in sql:
            rows = self.tables["rag_documents"]
            if "source_id = ? AND external_id = ?" in sql:
                return [r for r in rows if r["source_id"] == p[0] and r.get("external_id") == p[1]]
            if "source_id = ? AND content_hash = ?" in sql:
                return [r for r in rows if r["source_id"] == p[0] and r["content_hash"] == p[1]]
            if "WHERE id = ?" in sql:
                return [r for r in rows if r["id"] == p[0]]
            if "WHERE source_id = ?" in sql:
                return [r for r in rows if r["source_id"] == p[0]]
            raise AssertionError(f"unsupported docs query: {sql}")
        if "FROM rag_chunks" in sql and "document_id IN" in sql:
            count = sql.count("?")
            return [
                {"id": r["id"], "user_id": r["user_id"]} for r in self.tables["rag_chunks"]
                if r["document_id"] in p[:count]
            ]
        raise AssertionError(f"unsupported query: {sql}")

    async def fetch_one(self, sql: str, params: list[Any] | None = None) -> dict | None:
        rows = await self.fetch_all(sql, params)
        return rows[0] if rows else None


class FakeClient:
    def __init__(self, matches: list[dict] | None = None) -> None:
        self.matches = matches or []

    async def vector_query(
        self, user_id: str, kind: str, values: list, limit: int = 20, return_values: bool = False
    ):
        assert return_values is True
        return self.matches


class Backend:
    def __init__(self, fake: FakeRag, matches: list[dict] | None = None) -> None:
        self.store = fake
        self.client = FakeClient(matches)


async def fake_embed(_text: str) -> list[float]:
    return [0.5, 0.5]


def doc_input(source_id: str, text: str, external_id: str = "ext-1") -> IndexDocumentInput:
    return IndexDocumentInput(
        user_id="u-1", source_id=source_id, external_id=external_id,
        title="Doc", mime_type="text/plain", text=text, metadata_=None,
    )


class TestIndex:
    async def test_index_and_reindex(self) -> None:
        backend = Backend(FakeRag())
        source = await d1_backend.create_source(backend, "u-1", "notes", "manual")
        res = await d1_backend.index_document_d1(
            backend, doc_input(str(source["id"]), "hello world"), embed=fake_embed
        )
        assert res["status"] == "indexed"
        chunks = backend.store.tables["rag_chunks"]
        assert len(chunks) == 1
        ops = backend.store.tables["vector_sync_outbox"]
        assert len(ops) == 1 and ops[0]["operation"] == "upsert" and ops[0]["kind"] == "rag"

        again = await d1_backend.index_document_d1(
            backend, doc_input(str(source["id"]), "hello world"), embed=fake_embed
        )
        assert again["status"] == "unchanged"

        changed = await d1_backend.index_document_d1(
            backend, doc_input(str(source["id"]), "hello world, edited"), embed=fake_embed
        )
        assert changed["status"] == "indexed"
        deletes = [
            o for o in backend.store.tables["vector_sync_outbox"]
            if o["operation"] == "delete"
        ]
        assert len(deletes) == 1  # old chunk's vector retired

    async def test_push_document_replaces_chunks(self) -> None:
        backend = Backend(FakeRag())
        source = await d1_backend.create_source(backend, "u-1", "notes", "manual")
        doc, count = await d1_backend.push_document(
            backend, "u-1", str(source["id"]), "T", "text/plain", "alpha beta", None,
            embed=fake_embed,
        )
        assert count == 1
        doc2, _ = await d1_backend.push_document(
            backend, "u-1", str(source["id"]), "T2", "text/plain", "alpha beta", None,
            embed=fake_embed,
        )
        assert doc2["id"] == doc["id"] and doc2["title"] == "T2"
        assert len(backend.store.tables["rag_chunks"]) == 1

    async def test_push_missing_source_raises(self) -> None:
        backend = Backend(FakeRag())
        try:
            await d1_backend.push_document(
                backend, "u-1", "nope", "T", "text/plain", "x", None, embed=fake_embed
            )
        except LookupError:
            pass
        else:
            raise AssertionError("expected LookupError")


class TestSearchDelete:
    async def _seed(self, backend: Backend) -> str:
        source = await d1_backend.create_source(backend, "u-1", "notes", "manual")
        await d1_backend.index_document_d1(
            backend, doc_input(str(source["id"]), "the quick brown fox"), embed=fake_embed
        )
        chunk_id = backend.store.tables["rag_chunks"][0]["id"]
        return str(source["id"]), chunk_id

    async def test_search_snippets_and_log(self) -> None:
        backend = Backend(FakeRag())
        source_id, chunk_id = await self._seed(backend)
        backend.client.matches = [
            {"recordId": chunk_id, "revision": "v1", "score": 0.9, "values": [0.5, 0.5]}
        ]
        snippets = await d1_backend.search(backend, "u-1", "quick fox", 5, 3000, embed=fake_embed)
        assert len(snippets) == 1
        snippet = snippets[0]
        assert snippet["chunkId"] == chunk_id and snippet["marker"] == 1
        assert snippet["sourceId"] == source_id
        assert backend.store.tables["rag_retrieval_logs"]

    async def test_search_no_match_returns_empty(self) -> None:
        backend = Backend(FakeRag())
        await self._seed(backend)
        snippets = await d1_backend.search(backend, "u-1", "zzz-nope", 5, 3000, embed=fake_embed)
        assert snippets == []

    async def test_delete_source_cleans_vectors(self) -> None:
        backend = Backend(FakeRag())
        source_id, chunk_id = await self._seed(backend)
        assert await d1_backend.delete_source(backend, "u-1", source_id) is True
        assert backend.store.tables["rag_documents"] == []
        deletes = [
            o for o in backend.store.tables["vector_sync_outbox"]
            if o["operation"] == "delete" and o["record_id"] == chunk_id
        ]
        assert deletes
        # Repeat deletes stay idempotent, mirroring the Postgres route.
        assert await d1_backend.delete_source(backend, "u-1", source_id) is True

    async def test_mirror_round_trip(self) -> None:
        backend = Backend(FakeRag())
        assert await d1_backend.upsert_mirror_source(
            backend, "u-1", {"path": "/a.md", "content": "mirror me"}, embed=fake_embed
        ) is True
        listed = await d1_backend.list_sources(backend, "u-1")
        assert listed[0]["documentCount"] == 1 and listed[0]["chunkCount"] == 1
        assert await d1_backend.delete_mirror_source(backend, "u-1", "/a.md") is True
        # Repeat deletes stay idempotent, mirroring the Postgres route.
        assert await d1_backend.delete_mirror_source(backend, "u-1", "/a.md") is True
