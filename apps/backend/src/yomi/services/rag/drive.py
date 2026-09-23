"""Google Drive auto-sync RAG sources (Composio-backed).

A ``google-drive`` RagSource pins a Drive folder id (stored in ``path``):

- **Backfill** lists the folder's direct children, then indexes them in
  bounded batches (``BACKFILL_BATCH`` per tick). New children re-index via the
  content hash, so re-runs are idempotent; the source flips to ``active`` when
  the batch queue drains.
- **Incremental sync** consumes Google's Changes API from the stored
  ``startPageToken``: changed/created files inside the folder are re-indexed,
  trashed/removed files delete their document + vector, and the token
  advances.

Content pipeline: composio's export/download tool returns a presigned S3 URL;
the storage gateway Worker fetches that URL and stages the bytes as a
short-lived object in Cloudflare R2 (Workers Paid), which the backend reads
and deletes. This keeps composio's Amazon S3 entirely out of the container.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any

from yomi.services.cloudflare_storage.client import StorageError
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso
from yomi.services.rag import d1_backend
from yomi.services.rag.common import _clean
from yomi.services.rag.d1_backend import EmbedFn
from yomi.services.rag.embeddings import embed_text
from yomi.services.rag.index_document import IndexDocumentInput

GOOGLE_DRIVE_SOURCE_TYPE = "google-drive"
GOOGLEDRIVE_TOOLKIT = "googledrive"

BACKFILL_BATCH = 20
MAX_CHILDREN = 1000
MAX_SYNC_PAGES = 5
_SYNC_STATE_VERSION = 1

# Composio googledrive tool slugs (probed live against production).
_TOOL_LIST_FILES = "GOOGLEDRIVE_LIST_FILES"
_TOOL_PARSE_FILE = "GOOGLEDRIVE_PARSE_FILE"
_TOOL_GET_TOKEN = "GOOGLEDRIVE_GET_CHANGES_START_PAGE_TOKEN"
_TOOL_LIST_CHANGES = "GOOGLEDRIVE_LIST_CHANGES"

_GOOGLE_DOCUMENT = "application/vnd.google-apps.document"
_GOOGLE_SPREADSHEET = "application/vnd.google-apps.spreadsheet"
_GOOGLE_PRESENTATION = "application/vnd.google-apps.presentation"

_NATIVE_TEXT_MIMES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/tab-separated-values",
    "text/html",
    "text/xml",
    "application/json",
}
# Spreadsheets export to CSV (text/plain splits cells on newlines).
_EXPORT_MIME_BY_SOURCE = {
    _GOOGLE_DOCUMENT: "text/plain",
    _GOOGLE_PRESENTATION: "text/plain",
    _GOOGLE_SPREADSHEET: "text/csv",
}


class DriveToolError(RuntimeError):
    """A composio Drive action returned an error payload."""


def _attr(obj: Any, name: str, default: Any = None) -> Any:
    if obj is None:
        return default
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


async def _execute(session: Any, slug: str, arguments: dict[str, Any]) -> dict[str, Any]:
    try:
        response = await asyncio_to_thread_execute(session, slug, arguments)
    except Exception as exc:  # noqa: BLE001 — surface any error text to caller
        raise DriveToolError(str(exc)) from exc
    error = _attr(response, "error", None)
    if error:
        raise DriveToolError(str(_attr(error, "message", None) or error))
    data = _attr(response, "data", None)
    return data if isinstance(data, dict) else {}


async def asyncio_to_thread_execute(session: Any, slug: str, arguments: dict[str, Any]) -> Any:
    return await asyncio.to_thread(session.execute, slug, arguments=arguments)


def export_mime_for(mime: str) -> str | None:
    """Export MIME to ask composio for; ``None`` means the type is not text-indexable."""
    if not isinstance(mime, str) or not mime:
        return None
    known = _EXPORT_MIME_BY_SOURCE.get(mime)
    if known is not None:
        return known
    return "text/plain" if mime in _NATIVE_TEXT_MIMES else None


def _ingest_prefix(user_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", user_id)[:64]
    return f"drive/{safe}"


async def fetch_text(
    backend: D1Backend, session: Any, file_id: str, mime: str, user_id: str
) -> str | None:
    """Export/download a Drive file to text via R2-staged bytes (no S3 from
    the container). Returns ``None`` for unsupported or unreadable files."""
    export_mime = export_mime_for(mime)
    if export_mime is None:
        return None
    try:
        data = await _execute(
            session, _TOOL_PARSE_FILE, {"file_id": file_id, "mime_type": export_mime}
        )
        s3url = _attr(_attr(data, "file", None), "s3url", None)
        if not isinstance(s3url, str) or not s3url:
            return None
        client = backend.store.client
        stored = await client.ingest_put(s3url, prefix=_ingest_prefix(user_id))
        try:
            raw = await client.ingest_read(stored["key"])
        finally:
            await client.ingest_delete(stored["key"])
        return raw.decode("utf-8", errors="replace")
    except (DriveToolError, StorageError, ValueError):
        # A single bad file (e.g. Google's malware/spam guard, oversized
        # content) must not sink the whole backfill/sync tick.
        return None


async def list_folder_files(session: Any, folder_id: str) -> list[dict[str, Any]]:
    """Direct children of ``folder_id`` (v1 depth: no recursion)."""
    files: list[dict[str, Any]] = []
    page_token: str | None = None
    args: dict[str, Any] = {
        "q": f"'{folder_id}' in parents and trashed = false",
        "pageSize": 100,
        "fields": "nextPageToken,files(id,name,mimeType,parents,modifiedTime)",
    }
    while True:
        if page_token is not None:
            args["pageToken"] = page_token
        data = await _execute(session, _TOOL_LIST_FILES, args)
        for item in data.get("files") or []:
            if isinstance(item, dict):
                files.append(item)
        nxt = data.get("nextPageToken")
        if not isinstance(nxt, str) or not nxt or len(files) >= MAX_CHILDREN:
            break
        page_token = nxt
    return files[:MAX_CHILDREN]


def _default_state(folder_id: str, folder_name: str) -> dict[str, Any]:
    return {
        "version": _SYNC_STATE_VERSION,
        "folderId": folder_id,
        "folderName": folder_name,
        "startPageToken": None,
        "pending": [],
        "pendingIndex": 0,
        "filesSkipped": 0,
        "filesIndexed": 0,
        "lastSync": None,
    }


def _load_state(source: dict[str, Any]) -> dict[str, Any]:
    raw = source.get("sync_state")
    state: dict[str, Any] = {}
    if isinstance(raw, dict):
        state = dict(raw)
    elif isinstance(raw, str) and raw:
        try:
            state = dict(json.loads(raw))
        except ValueError:
            state = {}
    merged = _default_state(
        str(source.get("path") or ""), str(source.get("name") or "")
    )
    merged.update({k: v for k, v in state.items() if v is not None})
    return merged


async def create_source(
    backend: D1Backend, user_id: str, folder_id: str, folder_name: str
) -> dict[str, Any]:
    """Insert a ``google-drive`` RagSource pinned to ``folder_id`` (backfilling)."""
    title = _clean(str(folder_name) or str(folder_id), 120)
    now = utcnow_iso()
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": title,
        "path": folder_id,
        "content_hash": None,
        "source_type": GOOGLE_DRIVE_SOURCE_TYPE,
        "privacy_scope": "cloud_rag",
        "status": "backfilling",
        "sync_state": _default_state(folder_id, title),
        "created_at": now,
        "updated_at": now,
    }
    await backend.store.atomic([backend.store.insert("rag_sources", row)])
    return d1_backend.source_json(row)


async def find_source(backend: D1Backend, user_id: str, folder_id: str) -> dict[str, Any] | None:
    """Live (non-deleted) google-drive source pinned to ``folder_id``."""
    return await backend.store.fetch_one(
        "SELECT * FROM rag_sources "
        "WHERE user_id = ? AND path = ? AND source_type = ? AND status <> 'deleted' LIMIT 1",
        [user_id, folder_id, GOOGLE_DRIVE_SOURCE_TYPE],
    )


async def build_drive_session(user_id: str) -> tuple[Any, bool]:
    """Composio session for the user + whether googledrive is ACTIVE.

    Returns ``(None, False)`` when Composio is unconfigured, googledrive isn't
    among configured toolkits, or the session can't be reached.
    """
    from yomi.connectors.composio import (
        configured_toolkit_ids,
        connected_toolkit_ids,
        get_composio,
        resolve_entity_id,
    )

    client = get_composio()
    if client is None or GOOGLEDRIVE_TOOLKIT not in configured_toolkit_ids():
        return None, False
    session = client.create(user_id=resolve_entity_id(user_id))
    try:
        connected = await connected_toolkit_ids(session, configured_toolkit_ids())
    except Exception:  # noqa: BLE001 — connection check must not block the request
        return session, False
    return session, GOOGLEDRIVE_TOOLKIT in connected


async def _index_file(
    backend: D1Backend,
    user_id: str,
    session: Any,
    source: dict[str, Any],
    state: dict[str, Any],
    file: dict[str, Any],
    folder_id: str,
    counts: dict[str, int],
    embed: EmbedFn = embed_text,
) -> None:
    file_id = str(file.get("id") or "")
    if not file_id:
        counts["skipped"] += 1
        state["filesSkipped"] += 1
        return
    text = await fetch_text(
        backend, session, file_id, str(file.get("mimeType") or ""), user_id
    )
    if text is None:
        counts["skipped"] += 1
        state["filesSkipped"] += 1
        return
    result = await d1_backend.index_document_d1(
        backend,
        IndexDocumentInput(
            user_id=user_id,
            source_id=str(source["id"]),
            external_id=file_id,
            title=_clean(str(file.get("name") or file_id), 200),
            mime_type=str(file.get("mimeType") or "text/plain"),
            text=text,
            metadata_={
                "fileId": file_id,
                "folderId": folder_id,
                "mimeType": file.get("mimeType"),
                "origin": "google_drive",
            },
        ),
        embed=embed,
    )
    if result["status"] == "indexed":
        counts["indexed"] += 1
        state["filesIndexed"] += 1
    else:
        counts["unchanged"] += 1


async def backfill_tick(
    backend: D1Backend,
    user_id: str,
    session: Any,
    source: dict[str, Any],
    embed: EmbedFn = embed_text,
) -> dict[str, Any]:
    """Index up to ``BACKFILL_BATCH`` children; flip the source to ``active``
    when the queue drains. Lists children fresh every tick so composio's
    file lookups stay warm before each export."""
    source_id = str(source["id"])
    state = _load_state(source)
    folder_id = str(source.get("path") or state.get("folderId") or "")
    files = await list_folder_files(session, folder_id)

    state["pending"] = [
        {"id": str(f.get("id") or ""), "name": f.get("name"), "mimeType": f.get("mimeType")}
        for f in files
        if f.get("id")
    ]
    idx = int(state.get("pendingIndex") or 0)
    if idx > len(state["pending"]):
        idx = 0
    batch = state["pending"][idx : idx + BACKFILL_BATCH]

    counts = {"indexed": 0, "unchanged": 0, "skipped": 0}
    for file in batch:
        await _index_file(backend, user_id, session, source, state, file, folder_id, counts, embed)

    idx += len(batch)
    state["pendingIndex"] = idx
    done = idx >= len(state["pending"])
    if done:
        if not state.get("startPageToken"):
            try:
                token = await _execute(session, _TOOL_GET_TOKEN, {})
                state["startPageToken"] = token.get("startPageToken")
            except DriveToolError:
                state["startPageToken"] = None
        state["lastSync"] = utcnow_iso()
        await d1_backend.update_source_state(
            backend, source_id, status="active", sync_state=state
        )
    else:
        await d1_backend.update_source_state(backend, source_id, sync_state=state)
    return {
        "status": "active" if done else "backfilling",
        "remaining": max(0, len(state["pending"]) - idx),
        "indexed": counts["indexed"],
        "unchanged": counts["unchanged"],
        "skipped": counts["skipped"],
    }


async def _external_ids(backend: D1Backend, source_id: str) -> set[str]:
    rows = await backend.store.fetch_all(
        "SELECT external_id FROM rag_documents WHERE source_id = ?", [source_id]
    )
    return {str(r["external_id"]) for r in rows if r.get("external_id")}


async def incremental_sync(
    backend: D1Backend,
    user_id: str,
    session: Any,
    source: dict[str, Any],
    embed: EmbedFn = embed_text,
) -> dict[str, Any]:
    """Reconcile against Google's Changes API since the stored page token."""
    source_id = str(source["id"])
    state = _load_state(source)
    folder_id = str(source.get("path") or state.get("folderId") or "")

    token = state.get("startPageToken")
    if not token:
        token_data = await _execute(session, _TOOL_GET_TOKEN, {})
        token = token_data.get("startPageToken")
        if not token:
            raise DriveToolError("drive start page token unavailable")
    indexed = await _external_ids(backend, source_id)

    counts = {"indexed": 0, "unchanged": 0, "deleted": 0, "skipped": 0}
    pages = 0
    warmed = False
    while token and pages < MAX_SYNC_PAGES:
        data = await _execute(
            session,
            _TOOL_LIST_CHANGES,
            {
                "pageToken": token,
                "fields": (
                    "changes(fileId,removed,file(id,name,mimeType,parents,trashed)),"
                    "nextPageToken,newStartPageToken"
                ),
                "pageSize": 100,
            },
        )
        pages += 1
        for change in data.get("changes") or []:
            if not isinstance(change, dict):
                continue
            file_id = str(change.get("fileId") or "")
            file = change.get("file") or {}
            if isinstance(file, dict) and file.get("id"):
                file_id = str(file["id"])
            removed = bool(change.get("removed")) or bool(file.get("trashed"))
            if removed:
                if await d1_backend.delete_document_by_external_id(
                    backend, user_id, source_id, file_id
                ):
                    counts["deleted"] += 1
                    indexed.discard(file_id)
                continue
            parents = file.get("parents") or []
            if isinstance(parents, str):
                parents = [p.strip() for p in parents.split(",") if p.strip()]
            known = file_id in indexed
            if not (known or folder_id in parents):
                continue
            # composio's export lookup needs recently-listed ids; the folder
            # listing warms it before the first export of this tick.
            if not warmed:
                await list_folder_files(session, folder_id)
                warmed = True
            if not known:
                indexed.add(file_id)
            await _index_file(
                backend, user_id, session, source, state, file, folder_id, counts, embed
            )

        nxt = data.get("nextPageToken")
        if isinstance(nxt, str) and nxt:
            token = nxt
        else:
            final = data.get("newStartPageToken")
            if isinstance(final, str) and final:
                state["startPageToken"] = final
            token = None

    state["lastSync"] = utcnow_iso()
    await d1_backend.update_source_state(backend, source_id, sync_state=state)
    return {
        "pages": pages,
        "startPageToken": state.get("startPageToken"),
        **counts,
    }