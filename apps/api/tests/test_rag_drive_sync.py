"""Behavioral tests for Google Drive auto-sync RAG sources (composio + D1)."""

from __future__ import annotations

import json
from typing import Any

from test_rag_d1_backend import FakeRag, fake_embed

from yomi.services.rag import d1_backend, drive

DOC = "application/vnd.google-apps.document"
SHEET = "application/vnd.google-apps.spreadsheet"
VIDEO = "video/mp4"
TXT = "text/plain"

_FOLDER = "folder-1"


class FakeDriveRag(FakeRag):
    """FakeRag plus the drive-shape UPDATE/query support."""

    async def atomic(self, statements: list):
        out: list[dict] = []
        for stmt in statements:
            sql = stmt.sql
            if sql.startswith("UPDATE rag_sources SET") and "AND id = ?" not in sql:
                marker = " updated_at = ? WHERE id = ?"
                assert marker in sql, sql
                head = sql[: sql.index(marker)]
                row = next(r for r in self.tables["rag_sources"] if r["id"] == stmt.params[-1])
                clause_text = head[len("UPDATE rag_sources SET ") :].rstrip(",")
                cols = [part.split("=")[0].strip() for part in clause_text.split(",")]
                row.update(dict(zip(cols, stmt.params[1:-1], strict=True)))
                row["updated_at"] = stmt.params[0]
                out.append({"success": True})
            else:
                out.extend(await super().atomic([stmt]))
        return out

    async def fetch_all(self, sql: str, params: list[Any] | None = None) -> list[dict]:
        p = list(params or [])
        if "FROM rag_sources" in sql and "status <> 'deleted'" in sql:
            return [
                r for r in self.tables["rag_sources"]
                if r["user_id"] == p[0] and r.get("path") == p[1]
                and r.get("source_type") == p[2] and r.get("status") != "deleted"
            ]
        if "FROM rag_sources" in sql and "status IN" in sql:
            return [
                r for r in self.tables["rag_sources"]
                if r.get("source_type") == p[0] and r.get("status") in ("active", "backfilling")
            ]
        return await super().fetch_all(sql, params)


class FakeResponse:
    def __init__(self, data: Any = None, error: Any = None) -> None:
        self.data = data
        self.error = error


class FakeDriveSession:
    def __init__(
        self,
        listing: list[dict] | None = None,
        changes: dict[str, dict] | None = None,
        token: str = "tok-start",
    ) -> None:
        self.listing = list(listing or [])
        self.changes = changes or {}
        self.token = token
        self.executed: list[tuple[str, dict]] = []

    def execute(self, slug: str, arguments: dict | None = None) -> FakeResponse:
        args = dict(arguments or {})
        self.executed.append((slug, args))
        if slug == "GOOGLEDRIVE_LIST_FILES":
            return FakeResponse(data={"files": self.listing})
        if slug == "GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN":
            return FakeResponse(data={"startPageToken": self.token})
        if slug == "GOOGLEDRIVE_LIST_CHANGES":
            page = args.get("pageToken") or "start"
            return FakeResponse(data=self.changes[page])
        if slug == "GOOGLEDRIVE_PARSE_FILE":
            file_id = args.get("file_id")
            return FakeResponse(
                data={"file": {"s3url": f"https://s3.example/{file_id}"}}
            )
        raise AssertionError(f"unexpected tool {slug} {args}")


class FakeIngestClient:
    def __init__(self) -> None:
        self.puts: list[tuple[str, str]] = []
        self.reads: list[str] = []
        self.deletes: list[str] = []
        self._n = 0

    async def ingest_put(self, url: str, prefix: str = "drive") -> dict:
        self._n += 1
        key = f"ingest/{prefix}/k{self._n}"
        self.puts.append((url, key))
        return {"key": key, "size": 20, "contentType": "text/plain"}

    async def ingest_read(self, key: str) -> bytes:
        self.reads.append(key)
        return b"drive file contents"

    async def ingest_delete(self, key: str) -> None:
        self.deletes.append(key)


class Backend:
    def __init__(self, store: FakeDriveRag, client: FakeIngestClient | None = None) -> None:
        self.store = store
        self.client = client or FakeIngestClient()
        # D1Store.client is the storage-gateway client in production; wire the
        # ingest fake there so ``fetch_text`` reaches it via ``store.client``.
        self.store.client = self.client


def _file(file_id: str, mime: str, name: str | None = None) -> dict:
    return {"id": file_id, "name": name or file_id, "mimeType": mime}


async def _seed(
    listing: list[dict],
    *,
    folder: str = _FOLDER,
    token: str = "tok-start",
) -> tuple[Backend, FakeDriveSession, dict]:
    backend = Backend(FakeDriveRag())
    session = FakeDriveSession(listing=listing, token=token)
    source = await drive.create_source(backend, "u-1", folder, "Drive folder")
    return backend, session, source


class TestExportMime:
    def test_map(self) -> None:
        assert drive.export_mime_for(DOC) == "text/plain"
        assert drive.export_mime_for(SHEET) == "text/csv"
        assert drive.export_mime_for(TXT) == "text/plain"
        assert drive.export_mime_for(VIDEO) is None


class TestBackfill:
    async def test_activates_and_indexes_all(self) -> None:
        backend, session, source = await _seed(
            [_file("doc-1", DOC, "readme"), _file("notes", TXT, "notes.txt")]
        )
        res = await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert res["status"] == "active"
        assert res["remaining"] == 0 and res["indexed"] == 2
        assert len(backend.store.tables["rag_documents"]) == 2

        stored = await d1_backend.get_source(backend, "u-1", str(source["id"]))
        state = json.loads(stored["sync_state"])
        assert state["startPageToken"] == "tok-start"
        assert state["filesIndexed"] == 2 and state["filesSkipped"] == 0

    async def test_indexes_text_and_cleanup_ingest(self) -> None:
        backend, session, source = await _seed([_file("notes", TXT, "notes.txt")])
        await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert "drive file contents" in backend.store.tables["rag_chunks"][0]["content"]
        assert (
            len(backend.client.puts)
            == len(backend.client.reads)
            == len(backend.client.deletes)
            == 1
        )
        key = backend.client.puts[0][1]
        assert backend.client.reads[0] == key and backend.client.deletes[0] == key

    async def test_skips_unsupported_mime(self) -> None:
        backend, session, source = await _seed([_file("clip", VIDEO, "video.mp4")])
        res = await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert res["status"] == "active" and res["skipped"] == 1 and res["indexed"] == 0
        assert backend.store.tables["rag_documents"] == []
        stored = await d1_backend.get_source(backend, "u-1", str(source["id"]))
        assert json.loads(stored["sync_state"])["filesSkipped"] == 1

    async def test_batches_beyond_cap(self) -> None:
        files = [_file(f"f-{i}", DOC) for i in range(25)]
        backend, session, source = await _seed(files)
        first = await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert first["status"] == "backfilling" and first["remaining"] == 5
        assert first["indexed"] == 20
        source = await d1_backend.get_source(backend, "u-1", str(source["id"]))
        second = await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert second["status"] == "active" and second["remaining"] == 0
        assert second["indexed"] == 5
        assert len(backend.store.tables["rag_documents"]) == 25

    async def test_rebackfill_is_idempotent(self) -> None:
        backend, session, source = await _seed([_file("doc-1", DOC, "readme")])
        await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        again = await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        assert again["indexed"] == 0 and again["unchanged"] == 1
        assert len(backend.store.tables["rag_documents"]) == 1


class TestIncremental:
    async def test_reconciles_changes(self) -> None:
        backend, session, source = await _seed(
            [_file("doc-1", DOC, "readme"), _file("notes", TXT, "notes.txt")]
        )
        await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)

        session.changes = {
            "tok-start": {
                "changes": [
                    {
                        "fileId": "new-1",
                        "file": {
                            "id": "new-1",
                            "name": "new",
                            "mimeType": DOC,
                            "parents": [_FOLDER],
                        },
                    },
                    {"fileId": "notes", "removed": True},
                    {
                        "fileId": "outside",
                        "file": {
                            "id": "outside", "name": "other", "mimeType": TXT,
                            "parents": ["folder-9"],
                        },
                    },
                    {
                        "fileId": "clip",
                        "file": {
                            "id": "clip", "name": "video", "mimeType": VIDEO, "parents": [_FOLDER],
                        },
                    },
                ],
                "newStartPageToken": "tok-2",
            },
        }
        res = await drive.incremental_sync(backend, "u-1", session, source, embed=fake_embed)
        assert res["indexed"] == 1 and res["deleted"] == 1 and res["skipped"] == 1
        assert res["pages"] == 1 and res["startPageToken"] == "tok-2"
        assert len(backend.store.tables["rag_documents"]) == 2  # doc-1 + new-1

        stored = await d1_backend.get_source(backend, "u-1", str(source["id"]))
        assert json.loads(stored["sync_state"])["startPageToken"] == "tok-2"

    async def test_paginates_to_new_start_token(self) -> None:
        backend, session, source = await _seed([], token="tok-a")
        await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        session.changes = {
            "tok-a": {
                "changes": [
                    {
                        "fileId": "extra",
                        "file": {"id": "extra", "name": "e", "mimeType": TXT, "parents": [_FOLDER]},
                    }
                ],
                "nextPageToken": "tok-b",
            },
            "tok-b": {"changes": [], "newStartPageToken": "tok-c"},
        }
        res = await drive.incremental_sync(backend, "u-1", session, source, embed=fake_embed)
        assert res["pages"] == 2 and res["indexed"] == 1
        assert res["startPageToken"] == "tok-c"
        assert len(backend.store.tables["rag_documents"]) == 1

    async def test_warms_folder_once_before_exports(self) -> None:
        backend, session, source = await _seed([_file("doc-1", DOC, "readme")], token="tok-a")
        await drive.backfill_tick(backend, "u-1", session, source, embed=fake_embed)
        session.changes = {
            "tok-a": {
                "changes": [
                    {
                        "fileId": "changed-1",
                        "file": {
                            "id": "changed-1", "name": "c", "mimeType": DOC, "parents": [_FOLDER],
                        },
                    }
                ],
                "newStartPageToken": "tok-b",
            },
        }
        await drive.incremental_sync(backend, "u-1", session, source, embed=fake_embed)
        list_calls = [s for s, _ in session.executed if s == "GOOGLEDRIVE_LIST_FILES"]
        assert len(list_calls) == 2  # backfill's listing + one incremental warm-up


class TestSource:
    async def test_create_find_duplicate(self) -> None:
        backend = Backend(FakeDriveRag())
        source = await drive.create_source(backend, "u-1", "folder-1", "My folder")
        assert source["status"] == "backfilling"
        approx = await drive.find_source(backend, "u-1", "folder-1")
        assert approx is not None and approx["id"] == source["id"]

    async def test_ops_queries_active_sources(self) -> None:
        backend = Backend(FakeDriveRag())
        source = await drive.create_source(backend, "u-1", "folder-1", "My folder")
        await d1_backend.update_source_state(backend, str(source["id"]), status="active")
        fetched = await d1_backend.drive_sources_for_ops(backend, limit=5)
        assert any(s["id"] == source["id"] for s in fetched)