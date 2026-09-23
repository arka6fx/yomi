from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

import httpx
import pytest

from yomi.services.cloudflare_storage.client import Statement, StorageClient, StorageError
from yomi.services.cloudflare_storage.migration import (
    checksum_ids,
    export_row,
    export_value,
    manifest_entry,
    transform_row,
)
from yomi.services.cloudflare_storage.store import D1Store, encode, parse_dt
from yomi.services.cloudflare_storage.vector_sync import claim_pending, enqueue_ops, sweep_once


def client(handler) -> StorageClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return StorageClient(http, "https://storage.example.test", "s" * 32)


def test_statement_normalizes_boolean_parameters() -> None:
    assert Statement("select ?", [True]).payload() == {"sql": "select ?", "params": [1]}


def test_client_rejects_insecure_remote_gateway() -> None:
    with pytest.raises(ValueError, match="HTTPS"):
        StorageClient(httpx.AsyncClient(), "http://storage.example.test", "s" * 32)


@pytest.mark.asyncio
async def test_query_sends_bearer_token_without_leaking_it() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == f"Bearer {'s' * 32}"
        return httpx.Response(200, json={"success": True, "results": [{"id": "u-1"}]})

    storage = client(handler)
    try:
        assert await storage.query("select id from user where id = ?", ["u-1"]) == [
            {"id": "u-1"}
        ]
    finally:
        await storage.http.aclose()


@pytest.mark.asyncio
async def test_write_transport_failure_reports_unknown_outcome() -> None:
    async def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("secret upstream detail")

    storage = client(handler)
    try:
        with pytest.raises(StorageError, match="outcome may be unknown") as raised:
            await storage.batch([Statement("insert into user (id) values (?)", ["u-1"])])
        assert "secret upstream detail" not in str(raised.value)
    finally:
        await storage.http.aclose()


class TestEncode:
    def test_bool_datetime_uuid_json(self) -> None:
        assert encode(True) == 1
        assert encode(datetime(2026, 1, 1)) == "2026-01-01T00:00:00+00:00"
        assert encode({"b": 1, "a": 2}) == '{"a":2,"b":1}'
        assert encode(uuid.UUID(int=0)).startswith("00000000-")

    def test_rejects_arbitrary_objects(self) -> None:
        with pytest.raises(TypeError):
            encode(object())

    def test_parse_dt_round_trip(self) -> None:
        assert parse_dt("2026-09-22T00:00:00+00:00") == datetime(2026, 9, 22, tzinfo=UTC)
        assert parse_dt(None) is None
        assert parse_dt("garbage") is None


class FakeStore(D1Store):
    def __init__(self) -> None:
        self.batches: list[list[Statement]] = []
        self.claimed: list[dict] = []

    async def atomic(self, statements: list[Statement]) -> list[dict]:
        self.batches.append(statements)
        if any("SELECT id, user_id" in s.sql for s in statements):
            return [{}, {"results": self.claimed}]
        return [{"success": True} for _ in statements]


def test_enqueue_validates_vector_dimensions() -> None:
    store = FakeStore()
    with pytest.raises(ValueError, match="768"):
        enqueue_ops(store, [{
            "user_id": "u", "kind": "memory", "record_id": "m",
            "revision": "r", "operation": "upsert", "payload": {"values": [1.0]},
        }])
    stmts = enqueue_ops(store, [{
        "user_id": "u", "kind": "memory", "record_id": "m",
        "revision": "r", "operation": "delete", "payload": None,
    }])
    assert len(stmts) == 1 and "vector_sync_outbox" in stmts[0].sql


@pytest.mark.asyncio
async def test_claim_and_sweep_mark_processed() -> None:
    store = FakeStore()
    store.claimed = [{
        "id": "op-1", "user_id": "u", "kind": "memory", "record_id": "m",
        "revision": "r", "operation": "delete", "payload": None, "attempts": 1,
    }]
    posted: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        posted.append(request.url.path)
        return httpx.Response(200, json={"mutationId": "x"})

    storage = client(handler)
    try:
        result = await sweep_once(store, storage, limit=10)
    finally:
        await storage.http.aclose()
    assert result == {"claimed": 1, "processed": 1}
    assert posted == ["/vectors/delete"]
    assert any("processed_at" in s.sql for batch in store.batches for s in batch)


@pytest.mark.asyncio
async def test_failed_mutation_records_error_without_leak() -> None:
    store = FakeStore()
    store.claimed = [{
        "id": "op-2", "user_id": "u", "kind": "memory", "record_id": "m",
        "revision": "r", "operation": "delete", "payload": None, "attempts": 1,
    }]

    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, json={"error": "secret upstream detail"})

    storage = client(handler)
    try:
        result = await sweep_once(store, storage, limit=10)
    finally:
        await storage.http.aclose()
    assert result == {"claimed": 1, "processed": 1}
    error_updates = [
        s.params for batch in store.batches for s in batch if "last_error" in s.sql
    ]
    assert error_updates and "secret upstream detail" not in json.dumps(error_updates)


@pytest.mark.asyncio
async def test_claim_pending_rejects_out_of_range_limit() -> None:
    with pytest.raises(ValueError, match="1-100"):
        await claim_pending(FakeStore(), 0)


class TestMigrationTransforms:
    def test_export_value_normalizes_postgres_types(self) -> None:
        assert export_value(True) is True
        assert export_value(datetime(2026, 1, 1)) == "2026-01-01T00:00:00+00:00"
        assert export_value(uuid.UUID(int=1)) == "00000000-0000-0000-0000-000000000001"
        assert export_value("[0.1, 0.2]") == [0.1, 0.2]
        assert export_value(b"\x00\xff") == "00ff"
        assert export_row({"a": 1}) == {"a": 1}

    def test_transform_drops_generated_tsvector_columns(self) -> None:
        kind, cleaned = transform_row("memory_entries", {
            "id": "m", "content": "x", "content_tsv": "ts", "summary_tsv": "ts2",
        })
        assert kind == "data"
        assert "content_tsv" not in cleaned and cleaned["content"] == "x"

    def test_transform_routes_embeddings_to_vector_outbox(self) -> None:
        kind, op = transform_row("memory_embeddings", {
            "id": "e-1", "user_id": "u", "memory_id": "m-1", "embedding": [0.5, 0.25],
        })
        assert kind == "vector"
        assert op["record_id"] == "m-1" and op["revision"] == "neon:e-1"
        assert op["payload"] == {"values": [0.5, 0.25]}

    def test_transform_rejects_empty_vector(self) -> None:
        with pytest.raises(ValueError, match="no vector"):
            transform_row("rag_embeddings", {
                "id": "e-2", "user_id": "u", "chunk_id": "c", "embedding": [],
            })

    def test_manifest_checksum_is_order_insensitive(self) -> None:
        rows = [{"id": "b"}, {"id": "a"}]
        assert manifest_entry("t", rows)["id_checksum"] == checksum_ids(["a", "b"])
