"""Neon Postgres -> Cloudflare D1 (+ Vectorize outbox) migration runner.

Usage (from apps/backend, with .env holding DATABASE_URL for Neon and
STORAGE_GATEWAY_URL/SECRET for the D1 gateway)::

    uv run python scripts/migrate_neon_to_d1.py export --out ./dump-neon
    uv run python scripts/migrate_neon_to_d1.py import --in ./dump-neon
    uv run python scripts/migrate_neon_to_d1.py verify --in ./dump-neon

Export streams every table to ``<out>/<table>.jsonl`` plus ``manifest.json``.
It only reads Neon; nothing is written anywhere. Import is idempotent
(``INSERT OR REPLACE`` + ``INSERT OR IGNORE`` on the outbox unique key), so a
failed run can be re-run safely. Verify compares per-table counts and id
checksums, then reports vector outbox pending/failed rows.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

MANIFEST_NAME = "manifest.json"


def _table_pk(table) -> str:
    keys = list(table.primary_key.columns)
    return keys[0].name if keys else "id"


async def cmd_export(out: Path) -> int:
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import create_async_engine

    from yomi.conf import settings
    from yomi.db import Base
    from yomi.db_session import asyncpg_database_url

    if not settings.database_url:
        print("DATABASE_URL is not set (add Neon URL to apps/backend/.env)", file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    engine = create_async_engine(asyncpg_database_url(settings.database_url), pool_pre_ping=True)
    manifest: list[dict] = []
    try:
        from yomi.services.cloudflare_storage.migration import (
            checksum_ids,
            encode_json_line,
            export_row,
        )

        async with engine.connect() as conn:
            for table in Base.metadata.sorted_tables:
                ids: list[str] = []
                count = 0
                path = out / f"{table.name}.jsonl"
                result = await conn.stream(select(table))
                with path.open("w", encoding="utf-8") as handle:
                    async for partition in result.partitions(500):
                        for row in partition:
                            exported = export_row(dict(row._mapping))
                            handle.write(encode_json_line(exported) + "\n")
                            pk = _table_pk(table)
                            ids.append(str(exported.get(pk, "")))
                            count += 1
                manifest.append({
                    "table": table.name,
                    "count": count,
                    "id_checksum": checksum_ids(ids),
                    "pk": _table_pk(table),
                })
                print(f"exported {table.name}: {count} rows")
    finally:
        await engine.dispose()
    (out / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"manifest written ({len(manifest)} tables)")
    return 0


def _iter_rows(path: Path):
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                yield json.loads(line)


async def _flush_data(store, table: str, batch: list) -> None:
    if batch:
        await store.atomic([store.insert_or_replace(table, row) for row in batch])


async def _flush_vectors(store, batch: list) -> None:
    if batch:
        await store.atomic([
            store.insert_or_ignore("vector_sync_outbox", {
                "id": op_id, "user_id": op["user_id"], "kind": op["kind"],
                "record_id": op["record_id"], "revision": op["revision"],
                "operation": op["operation"], "payload": op["payload"],
                "attempts": 0, "last_error": None,
                "created_at": op["created_at"], "processed_at": None,
            })
            for op_id, op in batch
        ])


async def _import_table(store, table: str, path: Path) -> tuple[int, int]:
    from yomi.services.cloudflare_storage.migration import D1_BATCH_SIZE, transform_row
    from yomi.services.cloudflare_storage.store import new_id, utcnow_iso

    data_batch: list = []
    vector_batch: list = []
    done = 0
    vectors = 0
    for row in _iter_rows(path):
        kind, cleaned = transform_row(table, row)
        if kind == "data":
            data_batch.append(cleaned)
            if len(data_batch) >= D1_BATCH_SIZE:
                await _flush_data(store, table, data_batch)
                done += len(data_batch)
                data_batch = []
        else:
            vector_batch.append((new_id(), {**cleaned, "created_at": utcnow_iso()}))
            if len(vector_batch) >= D1_BATCH_SIZE:
                await _flush_vectors(store, vector_batch)
                vectors += len(vector_batch)
                vector_batch = []
    await _flush_data(store, table, data_batch)
    done += len(data_batch)
    await _flush_vectors(store, vector_batch)
    vectors += len(vector_batch)
    return done, vectors


async def cmd_import(src: Path) -> int:
    import httpx

    from yomi.services.cloudflare_storage.client import StorageClient
    from yomi.services.cloudflare_storage.store import D1Store

    manifest = json.loads((src / MANIFEST_NAME).read_text(encoding="utf-8"))
    tables = {entry["table"]: entry for entry in manifest}
    try:
        from yomi.db import Base as _Base

        order = [t.name for t in _Base.metadata.sorted_tables if t.name in tables]
    except Exception:  # noqa: BLE001 — fall back to manifest order when models differ
        order = [entry["table"] for entry in manifest]
    order += [name for name in tables if name not in order]
    async with httpx.AsyncClient() as http:
        store = D1Store(StorageClient.configured(http))
        for table in order:
            path = src / f"{table}.jsonl"
            if not path.exists():
                print(f"missing {path}, skipping", file=sys.stderr)
                continue
            done, vectors = await _import_table(store, table, path)
            print(f"imported {table}: {done} rows, {vectors} vectors")
    print("import complete; run the vector sweeper to push embeddings to Vectorize")
    return 0


async def cmd_verify(src: Path) -> int:
    import httpx

    from yomi.services.cloudflare_storage.client import StorageClient
    from yomi.services.cloudflare_storage.migration import checksum_ids
    from yomi.services.cloudflare_storage.store import D1Store

    manifest = json.loads((src / MANIFEST_NAME).read_text(encoding="utf-8"))
    failures = 0
    async with httpx.AsyncClient() as http:
        store = D1Store(StorageClient.configured(http))
        for entry in manifest:
            table = entry["table"]
            if table in ("memory_embeddings", "rag_embeddings"):
                continue
            rows = await store.fetch_all(
                f'SELECT COUNT(*) AS n FROM "{table}"', []
            )
            count = int(rows[0]["n"]) if rows else 0
            status = "ok" if count == entry["count"] else "MISMATCH"
            if status != "ok":
                failures += 1
            print(f"{table}: neon={entry['count']} d1={count} {status}")
            if status == "ok" and count:
                pk = entry.get("pk", "id")
                id_rows = await store.fetch_all(f'SELECT "{pk}" AS pk FROM "{table}"', [])
                digest = checksum_ids([str(r["pk"]) for r in id_rows])
                match = "ok" if digest == entry["id_checksum"] else "CHECKSUM MISMATCH"
                if match != "ok":
                    failures += 1
                print(f"  checksum {match}")
        pending = await store.fetch_all(
            "SELECT COUNT(*) AS n FROM vector_sync_outbox WHERE processed_at IS NULL", []
        )
        failed = await store.fetch_all(
            "SELECT COUNT(*) AS n FROM vector_sync_outbox "
            "WHERE processed_at IS NULL AND attempts >= 25", []
        )
        print(f"outbox pending={(pending[0]['n'] if pending else '?')} "
              f"exhausted={(failed[0]['n'] if failed else '?')}")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Neon -> D1 migration runner")
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export")
    export.add_argument("--out", required=True)
    imp = sub.add_parser("import")
    imp.add_argument("--in", dest="src", required=True)
    ver = sub.add_parser("verify")
    ver.add_argument("--in", dest="src", required=True)
    args = parser.parse_args()
    if args.command == "export":
        return asyncio.run(cmd_export(Path(args.out)))
    if args.command == "import":
        return asyncio.run(cmd_import(Path(args.src)))
    return asyncio.run(cmd_verify(Path(args.src)))


if __name__ == "__main__":
    raise SystemExit(main())
