"""Google Drive connector.

Ported from `packages/agent-core/src/connectors/google-drive-def.ts`.
Provider key in `mcp_connections` is `google-drive`. Exposes 19 tools; writes
are gated through `gate_write`.
"""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from yomi.connectors.base import (
    IRREVERSIBLE,
    WRITE,
    ConnectorContext,
    ConnectorDef,
    ConnectorError,
    ConnectorTool,
    connector_error,
    gate_write,
)

_DRIVE_BASE = "https://www.googleapis.com/drive/v3"
_SHEETS_BASE = "https://sheets.googleapis.com/v4"
_DOCS_BASE = "https://docs.googleapis.com/v1"

MOZ_BLACK = "#101010"
GOOGLE_MIME_LABELS = {
    "application/vnd.google-apps.document": "Google Docs",
    "application/vnd.google-apps.spreadsheet": "Google Sheets",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.form": "Google Forms",
    "application/vnd.google-apps.drawing": "Google Drawings",
    "application/vnd.google-apps.audio": "Google Vault Audio",
    "application/vnd.google-apps.video": "Google Vault Video",
    "application/vnd.google-apps.folder": "Google Drive Folder",
    "application/vnd.google-apps.script": "Google Apps Script",
    "application/vnd.google-apps.shortcut": "Google Drive Shortcut",
    "application/vnd.google-apps.site": "Google Sites",
    "application/vnd.google-apps.jam": "Google Jamboard",
    "application/vnd.google-apps.map": "Google Maps",
    "application/vnd.google-apps.drive-sdk": "App",
    "application/vnd.google-apps.mail-layout": "Gmail Layout",
}
EXPORT_MIME = {
    "file": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "drawer": "application/vnd.google-apps.drawio",
    "slides": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "video": "video/mp4",
}
EXPORT_TARGETS = {
    "doc": "application/pdf",
    "gdoc": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "gsheet": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "gslides": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "gpdf": "application/pdf",
}

_MAX_BODY_LINES = 9
_MAX_BODY_CHARS = 520
_SPLIT_PATTERN = re.compile(r"\n\s*---+\s*\n", re.MULTILINE)


def escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _inline_markup(escaped: str) -> str:
    """Apply **bold**, `code`, and [link](url) markup to already-escaped text."""
    out = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', out)
    return out


def markdown_to_html(text: str) -> str:
    lines = text.splitlines()
    html_parts: list[str] = []
    list_stack: list[str] = []

    def close_lists(to: int) -> None:
        while len(list_stack) > to:
            html_parts.append(f"</{list_stack.pop()}>")

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        stripped = line.lstrip()
        indent = len(line) - len(stripped)
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            level = len(heading.group(1))
            formatted = _inline_markup(escape_xml(heading.group(2)))
            close_lists(0)
            html_parts.append(f"<h{level}>{formatted}</h{level}>")
            continue
        if stripped.startswith("- ") or stripped.startswith("* "):
            if not list_stack or list_stack[-1] != "ul":
                close_lists(0)
                html_parts.append("<ul>")
                list_stack.append("ul")
            html_parts.append(f"<li>{escape_xml(stripped[2:])}</li>")
            continue
        if re.match(r"^\d+\.\s", stripped):
            if not list_stack or list_stack[-1] != "ol":
                close_lists(0)
                html_parts.append("<ol>")
                list_stack.append("ol")
            item = re.sub(r"^\d+\.\s", "", stripped)
            html_parts.append(f"<li>{escape_xml(item)}</li>")
            continue
        blockquote = re.match(r"^>\s?(.*)$", stripped)
        if blockquote:
            close_lists(0)
            html_parts.append(f"<blockquote>{escape_xml(blockquote.group(1))}</blockquote>")
            continue
        if indent >= 4:
            close_lists(0)
            html_parts.append(f"<pre>{escape_xml(stripped)}</pre>")
            continue
        close_lists(0)
        html_parts.append(f"<p>{_inline_markup(escape_xml(stripped))}</p>")
    close_lists(0)
    html = "".join(html_parts)
    html = re.sub(r"<img src=\"([^\"]+)\"[^>]*>", r'<img src="\1" alt="" />', html)
    html = re.sub(r">(\s)+<", "><", html)
    return html


def parse_markdown_slides(text: str) -> list[dict[str, Any]]:
    slides: list[dict[str, Any]] = []
    for block in _SPLIT_PATTERN.split(text):
        block = block.strip()
        if not block:
            continue
        lines = block.splitlines()
        title = lines[0].lstrip("#").strip() if lines else ""
        body = [line.strip() for line in lines[1:] if line.strip()]
        slides.append({"title": title, "body": body, "header": bool(lines and lines[0].strip().startswith("#"))})
    return slides


def split_overlong_slide(slide: dict[str, Any]) -> list[dict[str, Any]]:
    body = list(slide.get("body") or [])
    parts: list[list[str]] = []
    while len(body) > _MAX_BODY_LINES:
        cut = 0
        total = 0
        for i, line in enumerate(body):
            if i >= _MAX_BODY_LINES - 1:
                break
            if total + len(line) + 1 > _MAX_BODY_CHARS:
                break
            total += len(line) + 1
            cut = i + 1
        if cut == 0:
            cut = 1
        parts.append(body[:cut])
        body = body[cut:]
    parts.append(body)
    return [{**slide, "body": part} for part in parts]


def insert_slides_content(slide: dict[str, Any]) -> dict[str, Any]:
    text = ""
    if slide.get("header"):
        text = f"{slide['title']}\n"
    text += "\n".join(slide.get("body") or [])
    return {"requests": [{"insertText": {"location": {"index": 0}, "text": text}}]}


def coerce_cell(value: str) -> Any:
    value = value.strip()
    if not value:
        return None
    low = value.lower()
    if low in {"true", "1"}:
        return True
    if low in {"false", "0"}:
        return False
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        pass
    return value


def parse_table_content(csv: str, action: str) -> dict[str, Any]:
    lines = [line for line in csv.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return {"api": action, "rows": []}
    header = [cell.strip() for cell in lines[0].split(",")]
    rows = [[coerce_cell(cell) for cell in line.split(",")] for line in lines[1:] if line.strip()]
    return {"api": action, "header": header, "rows": rows, "inner": "\n".join(lines)}


def insert_sheet_content(inner: str, action: str) -> dict[str, Any]:
    content = parse_table_content(inner, action)
    return {"api": action, "content": content.get("inner", ""), "fields": content.get("header") or []}


def _col_name(idx: int) -> str:
    name = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        name = chr(65 + rem) + name
    return name


def _gate_meta(*, action: str, risk: str, title: str, preview: str, confirm_text: str) -> dict:
    return {
        "connector": "google-drive",
        "action": action,
        "risk": risk,
        "title": title,
        "preview": preview,
        "confirm_text": confirm_text,
    }


def _spec(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


def create_drive_tools(ctx: ConnectorContext) -> dict[str, ConnectorTool]:
    async def drive(
        path: str, *, method: str = "GET", json_: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        token = await ctx.get_access_token(ctx.user_id, "google-drive")
        headers = {"Authorization": f"Bearer {token}"}
        if json_ is not None or method in {"POST", "PATCH", "PUT"}:
            headers["Content-Type"] = "application/json"
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.request(
                method, f"{_DRIVE_BASE}{path}", headers=headers, json=json_, params=params
            )
        if res.status_code >= 400:
            raise ConnectorError(f"Drive API {path} → {res.status_code}: {res.text[:200]}")
        if res.status_code == 204 or not res.text:
            return None
        return res.json()

    def sheets_headers(token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def sheets(
        path: str, *, method: str = "GET", token: str, json_: Any = None, params: dict[str, Any] | None = None
    ) -> Any:
        async with httpx.AsyncClient(timeout=60) as client:
            res = await client.request(
                method, f"{_SHEETS_BASE}{path}", headers=sheets_headers(token), json=json_, params=params
            )
        if res.status_code >= 400:
            raise ConnectorError(f"Sheets API {path} → {res.status_code}: {res.text[:200]}")
        if res.status_code == 204 or not res.text:
            return None
        return res.json()

    async def get_storage_quota(args: dict) -> dict:
        try:
            data = await drive("/about", params={"fields": "storageQuota"})
            quota = (data or {}).get("storageQuota") or {}
            return {
                "limit": quota.get("limit"),
                "usage": quota.get("usage"),
                "usageInDrive": quota.get("usageInDrive"),
                "message": "Storage quota information retrieved successfully.",
            }
        except Exception as err:
            return connector_error(err)

    async def search_files(args: dict) -> dict:
        try:
            terms = [str(term).strip().strip('"') for term in (args.get("search") or "").split(",") if str(term).strip()]
            clauses: list[str] = []
            for term in terms:
                if term:
                    clauses.append(f'name contains "{term}"')
            query = " and ".join(clauses) if clauses else "trashed = false"
            params: dict[str, Any] = {"q": query, "pageSize": str(int(args.get("maxResults") or 10))}
            if args.get("parentId"):
                params["q"] = f'"{args["parentId"]}" in parents'
            data = await drive("/files", params=params)
            files = [
                {
                    "id": f.get("id"),
                    "name": f.get("name"),
                    "mimeType": f.get("mimeType"),
                    "type": GOOGLE_MIME_LABELS.get(f.get("mimeType") or "", "File"),
                    "modifiedTime": f.get("modifiedTime"),
                }
                for f in (data or {}).get("files") or []
            ]
            if not files:
                return {"files": [], "message": "No files found matching your search."}
            return {"count": len(files), "files": files}
        except Exception as err:
            return connector_error(err)

    async def list_files(args: dict) -> dict:
        try:
            params: dict[str, Any] = {"pageSize": str(int(args.get("maxResults") or 20))}
            if args.get("parentId"):
                params["q"] = f'"{args["parentId"]}" in parents'
            if args.get("sortBy") == "time":
                params["orderBy"] = f"modifiedTime{' desc' if args.get('reverse') else ''}"
            elif args.get("sortBy") == "name":
                params["orderBy"] = f"name{' desc' if args.get('reverse') else ''}"
            data = await drive("/files", params=params)
            files = [
                {
                    "id": f.get("id"),
                    "name": f.get("name"),
                    "mimeType": f.get("mimeType"),
                    "type": GOOGLE_MIME_LABELS.get(f.get("mimeType") or "", "File"),
                    "size": f.get("size"),
                    "modifiedTime": f.get("modifiedTime"),
                }
                for f in (data or {}).get("files") or []
            ]
            if not files:
                return {"files": [], "message": "No files found."}
            return {"count": len(files), "files": files}
        except Exception as err:
            return connector_error(err)

    async def get_file(args: dict) -> dict:
        try:
            file_id = str(args.get("fileId") or args.get("id"))
            data = await drive(
                f"/files/{file_id}",
                params={"fields": "id,name,mimeType,size,createdTime,modifiedTime,parents,trashed,webViewLink,description,tags,version"},
            )
            return {
                "id": data.get("id"),
                "name": data.get("name"),
                "mimeType": data.get("mimeType"),
                "type": GOOGLE_MIME_LABELS.get(data.get("mimeType") or "", "File"),
                "size": data.get("size"),
                "createdTime": data.get("createdTime"),
                "modifiedTime": data.get("modifiedTime"),
                "described": data.get("description"),
                "parents": data.get("parents"),
                "link": data.get("webViewLink"),
                "version": data.get("version"),
            }
        except Exception as err:
            return connector_error(err)

    async def read_file(args: dict) -> dict:
        try:
            file_id = str(args.get("fileId") or args.get("id"))
            meta = await drive(
                f"/files/{file_id}", params={"fields": "id,name,mimeType,size,webViewLink"}
            )
            mime = meta.get("mimeType") or ""
            readable = {
                "text/plain",
                "text/csv",
                "text/html",
                "text/markdown",
                "application/json",
                "application/xml",
                "text/xml",
                "application/vnd.google-apps.document",
                "application/vnd.google-apps.jam",
            }
            if mime in readable or mime.startswith("text/") or mime.endswith(("+json", "+xml")):
                content = await drive(
                    f"/files/{file_id}/export" if mime == "application/vnd.google-apps.document" else f"/files/{file_id}",
                    params={"alt": "media", "mimeType": "text/plain"} if mime == "application/vnd.google-apps.document" else {"alt": "media"},
                )
                if isinstance(content, str):
                    return {
                        "id": file_id,
                        "name": meta.get("name"),
                        "mimeType": mime,
                        "text": content,
                        "message": "File content retrieved.",
                    }
            if mime == "application/vnd.google-apps.spreadsheet":
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                data = await sheets(
                    f"/spreadsheets/{file_id}/values/A1:Z100",
                    token=token,
                    params={"valueRenderOption": "FORMATTED_VALUE"},
                )
                return {
                    "id": file_id,
                    "name": meta.get("name"),
                    "mimeType": mime,
                    "rows": (data or {}).get("values") or [],
                    "message": "Spreadsheet content retrieved (first 100 rows).",
                }
            return {
                "id": file_id,
                "name": meta.get("name"),
                "mimeType": mime,
                "location": meta.get("webViewLink"),
                "message": (
                    f"Binary or unsupported file ({mime}). Download it from the Drive web app: "
                    f"{meta.get('webViewLink')}"
                ),
            }
        except Exception as err:
            return connector_error(err)

    async def create_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                name = args.get("filename") or args.get("name") or "Untitled"
                parent_id = args.get("parentId") or args.get("parents")
                parents = [parent_id] if parent_id else None
                mime = args.get("mimeType") or "text/plain"
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                pre_target: dict[str, Any] = {"name": name, "mimeType": mime}
                if parents:
                    pre_target["parents"] = parents
                boundary = "yomi_boundary_" + str(abs(hash(name)))
                meta_blob = json.dumps(pre_target)
                body = (
                    f"--{boundary}\r\n"
                    f'Content-Type: application/json; charset=UTF-8\r\n\r\n'
                    f"{meta_blob}\r\n"
                    f"--{boundary}\r\n"
                    f"Content-Type: text/plain\r\n\r\n"
                    f"{args.get('content') or ''}\r\n"
                    f"--{boundary}--"
                )
                headers = {
                    "Authorization": f"Bearer {token}",
                    "Content-Type": f"multipart/related; boundary={boundary}",
                }
                async with httpx.AsyncClient(timeout=120) as client:
                    res = await client.post(
                        f"{_DRIVE_BASE}/files", headers=headers, params={"uploadType": "multipart"}, content=body
                    )
                if res.status_code >= 400:
                    raise ConnectorError(f"Drive upload → {res.status_code}: {res.text[:300]}")
                data = res.json()
                return {
                    "ok": True,
                    "fileId": data.get("id"),
                    "link": data.get("webViewLink"),
                    "message": f'File "{name}" created in Drive.',
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-createFile",
                risk=WRITE,
                title=f"Create file: {args.get('filename') or args.get('name') or 'Untitled'}",
                preview=str(args.get("content") or "")[:500],
                confirm_text="Create file",
            ),
            args,
            run,
        )

    async def list_sheet_tabs(args: dict) -> dict:
        try:
            file_id = str(args.get("fileId") or args.get("id"))
            token = await ctx.get_access_token(ctx.user_id, "google-drive")
            data = await sheets(
                f"/spreadsheets/{file_id}",
                token=token,
                params={"fields": "sheets.properties(title,sheetId,index,sheetType)"},
            )
            tabs = []
            for sheet in (data or {}).get("sheets") or []:
                props = sheet.get("properties") or {}
                if not props.get("title"):
                    continue
                tabs.append(
                    {
                        "name": props.get("title"),
                        "sheetId": props.get("sheetId"),
                        "index": props.get("index"),
                        "type": props.get("sheetType"),
                    }
                )
            if not tabs:
                return {"tabs": [], "message": "No tabs found in this spreadsheet."}
            return {"count": len(tabs), "tabs": tabs}
        except Exception as err:
            return connector_error(err)

    async def read_sheet(args: dict) -> dict:
        try:
            file_id = str(args.get("fileId") or args.get("id"))
            sheet = args.get("sheet") or "first"
            token = await ctx.get_access_token(ctx.user_id, "google-drive")
            if sheet == "first" or sheet is None:
                meta = await sheets(f"/spreadsheets/{file_id}", token=token, params={"fields": "sheets.properties(title)"})
                props = ((meta or {}).get("sheets") or [{}])[0].get("properties") or {}
                sheet = props.get("title") or file_id
            range_override = args.get("rangeOverride")
            sheet_range = range_override or f"{sheet}!A:Z"
            data = await sheets(
                f"/spreadsheets/{file_id}/values/{sheet_range}",
                token=token,
                params={"valueRenderOption": "FORMATTED_VALUE"},
            )
            values = (data or {}).get("values") or []
            if not values:
                return {"rows": [], "message": "The sheet is empty or out of range."}
            if args.get("headerMode"):
                headers = values[0]
                rows = [dict(zip(headers, row, strict=False)) for row in values[1:]]
                return {"headers": headers, "rows": rows}
            return {"rows": values}
        except Exception as err:
            return connector_error(err)

    async def sheet_write(file_id: str, start_row: int, value_rows: list[list[Any]], token: str) -> dict:
        end_col = _col_name(max(1, max(len(r) for r in value_rows)) - 1)
        sheet_range = f"A{start_row}:{end_col}{start_row + len(value_rows) - 1}"
        data = await sheets(
            f"/spreadsheets/{file_id}/values/{sheet_range}",
            method="PUT",
            token=token,
            params={"valueInputOption": "USER_ENTERED"},
            json_={"range": sheet_range, "majorDimension": "ROWS", "values": value_rows},
        )
        return data or {}

    async def append_sheet_rows(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                sheet = args.get("sheet") or "Sheet1"
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                content = insert_sheet_content(str(args.get("csvContent") or ""), "append")
                rows = [
                    [str(cell) if cell is not None else "" for cell in row]
                    for row in parse_table_content(content["content"], "append")["rows"]
                ]
                if not rows:
                    return {"ok": True, "message": "No rows to append (empty content)."}
                start_row = 1
                await sheet_write(file_id, start_row, rows, token)
                return {
                    "ok": True,
                    "rowsAppended": len(rows),
                    "message": f"Appended {len(rows)} row(s) to {sheet}.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-appendSheetRows",
                risk=WRITE,
                title="Append rows to spreadsheet",
                preview=str(args.get("csvContent") or "")[:500],
                confirm_text="Append rows",
            ),
            args,
            run,
        )

    async def update_sheet_range(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                sheet = args.get("sheet") or "Sheet1"
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                content = str(args.get("csvContent") or "")
                rows = [
                    [str(cell) if cell is not None else "" for cell in row]
                    for row in parse_table_content(content, "update")["rows"]
                ]
                if not rows:
                    return {"ok": True, "message": "Nothing to write."}
                start_row = int(args.get("startRow") or 1)
                await sheet_write(file_id, start_row, rows, token)
                return {
                    "ok": True,
                    "rowsWritten": len(rows),
                    "range": f"{sheet}!A{start_row}",
                    "message": f"Wrote {len(rows)} row(s) to {sheet}.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-updateSheetRange",
                risk=WRITE,
                title="Write to spreadsheet range",
                preview=str(args.get("csvContent") or "")[:500],
                confirm_text="Write to sheet",
            ),
            args,
            run,
        )

    async def append_to_doc(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                content = markdown_to_html(str(args.get("content") or ""))
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                async with httpx.AsyncClient(timeout=60) as client:
                    res = await client.post(
                        f"{_DOCS_BASE}/documents/{file_id}:batchUpdate",
                        headers=headers,
                        json_={"requests": [{"insertText": {"location": {"index": 1}, "text": content}}]},
                    )
                if res.status_code >= 400:
                    raise ConnectorError(f"Docs API → {res.status_code}: {res.text[:200]}")
                return {"ok": True, "message": f"Content appended to document {file_id}."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-appendToDoc",
                risk=WRITE,
                title=f"Append to document {args.get('fileId') or args.get('id')}",
                preview=str(args.get("content") or "")[:500],
                confirm_text="Append to doc",
            ),
            args,
            run,
        )

    async def replace_in_doc(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                find = {"text": args.get("findText") or "", "matchCase": bool(args.get("matchCase"))}
                replace = {"text": args.get("replaceText") or ""}
                async with httpx.AsyncClient(timeout=60) as client:
                    res = await client.post(
                        f"{_DOCS_BASE}/documents/{file_id}:batchUpdate",
                        headers=headers,
                        json_={"requests": [{"replaceAllText": {"containsText": find, "replaceText": replace["text"]}}]},
                    )
                if res.status_code >= 400:
                    raise ConnectorError(f"Docs API → {res.status_code}: {res.text[:200]}")
                status = res.json()
                count = (status.get("replies") or [{}])[0].get("replaceAllText", {}).get("occurrencesChanged", 0)
                return {"ok": True, "occurrencesChanged": count, "message": f"Replaced {count} occurrence(s) in {file_id}."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-replaceInDoc",
                risk=WRITE,
                title=f"Replace text in document {args.get('fileId') or args.get('id')}",
                preview=f"Find: {args.get('findText')} → Replace: {args.get('replaceText')}",
                confirm_text="Replace text",
            ),
            args,
            run,
        )

    async def update_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                patch: dict[str, Any] = {}
                if args.get("name"):
                    patch["name"] = args["name"]
                if args.get("description"):
                    patch["description"] = args["description"]
                if args.get("addParents") or args.get("addToParent"):
                    patch["addParents"] = args.get("addParents") or args.get("addToParent")
                if args.get("removeParents") is not None:
                    patch["removeParents"] = args["removeParents"]
                if args.get("stars") is not None:
                    patch["starred"] = bool(args["stars"])
                if args.get("sharedLink") is not None:
                    patch["webViewLink"] = args["sharedLink"]
                data = await drive(f"/files/{file_id}", method="PATCH", json_=patch)
                return {
                    "ok": True,
                    "fileId": data.get("id"),
                    "name": data.get("name"),
                    "message": f"File {file_id} updated.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-updateFile",
                risk=WRITE,
                title=f"Update file {args.get('fileId') or args.get('id')}",
                preview=", ".join(
                    f"{key}: {value}" for key, value in args.items() if key in {"name", "description", "stars"}
                ),
                confirm_text="Update file",
            ),
            args,
            run,
        )

    async def delete_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                await drive(f"/files/{file_id}", method="DELETE")
                return {"ok": True, "message": f"File {file_id} deleted from Drive."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-deleteFile",
                risk=IRREVERSIBLE,
                title=f"Delete file {args.get('fileId') or args.get('id')} from Drive",
                preview="Permanently remove this file. This cannot be undone.",
                confirm_text="Delete file",
            ),
            args,
            run,
        )

    async def share_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                spec = str(args.get("share") or "").strip()
                role = "reader"
                email = spec
                if "@" in spec:
                    role, email = spec.split("@", 1)
                if role not in {"reader", "writer", "commenter", "owner"}:
                    role = "reader"
                params: dict[str, Any] = {"sendNotificationEmail": "true"}
                if role == "owner":
                    params["transferOwnership"] = "true"
                data = await drive(
                    f"/files/{file_id}/permissions",
                    method="POST",
                    params=params,
                    json_={"role": role, "type": "user", "emailAddress": email},
                )
                perm_id = data.get("id")
                perm = await drive(f"/files/{file_id}/permissions/{perm_id}")
                return {
                    "ok": True,
                    "role": perm.get("role"),
                    "emailAddress": perm.get("emailAddress"),
                    "message": f"Shared {file_id} with {email} as {role}.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-shareFile",
                risk=WRITE,
                title=f"Share file {args.get('fileId') or args.get('id')}",
                preview=str(args.get("share") or ""),
                confirm_text="Share file",
            ),
            args,
            run,
        )

    async def copy_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                json_: dict[str, Any] = {}
                if args.get("name"):
                    json_["name"] = args["name"]
                data = await drive(f"/files/{file_id}/copy", method="POST", json_=json_)
                return {
                    "ok": True,
                    "newFileId": data.get("id"),
                    "name": data.get("name"),
                    "link": data.get("webViewLink"),
                    "message": f'Copied file as "{data.get("name")}".',
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-copyFile",
                risk=WRITE,
                title=f"Copy file {args.get('fileId') or args.get('id')}",
                preview=f"New name: {args.get('name') or '(same)'}",
                confirm_text="Copy file",
            ),
            args,
            run,
        )

    async def convert_file(args: dict) -> dict:
        async def run() -> dict:
            try:
                file_id = str(args.get("fileId") or args.get("id"))
                target = str(args.get("target") or "gdoc").lower()
                mime = EXPORT_TARGETS.get(target)
                if not mime:
                    return {"ok": False, "error": f"Unsupported target: {target}", "supported": list(EXPORT_TARGETS)}
                source = await drive(f"/files/{file_id}", params={"fields": "id,name,mimeType,parents"})
                token = await ctx.get_access_token(ctx.user_id, "google-drive")
                headers = {"Authorization": f"Bearer {token}"}
                async with httpx.AsyncClient(timeout=120) as client:
                    res = await client.get(
                        f"{_DRIVE_BASE}/files/{file_id}/export", headers=headers, params={"mimeType": mime}
                    )
                    if res.status_code >= 400:
                        raise ConnectorError(f"Drive export → {res.status_code}: {res.text[:200]}")
                    boundary = "yomi_convert_" + str(abs(hash(file_id)))
                    meta = json.dumps(
                        {"name": f"{source.get('name', 'converted')}.{target}", "mimeType": mime}
                    )
                    body = (
                        f"--{boundary}\r\n"
                        f"Content-Type: application/json; charset=UTF-8\r\n\r\n"
                        f"{meta}\r\n"
                        f"--{boundary}\r\n"
                        f"Content-Type: application/octet-stream\r\n\r\n"
                    )
                    upload = await client.post(
                        f"{_DRIVE_BASE}/files",
                        headers={**headers, "Content-Type": f"multipart/related; boundary={boundary}"},
                        params={"uploadType": "multipart"},
                        content=body.encode() + res.content + f"\r\n--{boundary}--".encode(),
                    )
                    if upload.status_code >= 400:
                        raise ConnectorError(f"Drive upload → {upload.status_code}: {upload.text[:200]}")
                data = upload.json()
                return {
                    "ok": True,
                    "conversionId": data.get("id"),
                    "targetFileId": data.get("id"),
                    "source": {"id": file_id, "name": source.get("name"), "mimeType": source.get("mimeType")},
                    "target": {"id": data.get("id"), "name": data.get("name"), "mimeType": mime},
                    "message": f"Converted {source.get('name')} to {target} format.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-convertFile",
                risk=WRITE,
                title=f"Convert file {args.get('fileId') or args.get('id')}",
                preview=f"Target: {args.get('target') or 'gdoc'}",
                confirm_text="Convert file",
            ),
            args,
            run,
        )

    async def list_permissions(args: dict) -> dict:
        try:
            file_id = str(args.get("fileId") or args.get("id"))
            data = await drive(f"/files/{file_id}/permissions", params={"fields": "permissions"})
            perms = [
                {
                    "id": p.get("id"),
                    "role": p.get("role"),
                    "type": p.get("type"),
                    "emailAddress": p.get("emailAddress"),
                    "displayName": p.get("displayName"),
                }
                for p in (data or {}).get("permissions") or []
            ]
            if not perms:
                return {"permissions": [], "message": "No permissions found."}
            return {"count": len(perms), "permissions": perms}
        except Exception as err:
            return connector_error(err)

    async def create_folder(args: dict) -> dict:
        async def run() -> dict:
            try:
                name = args.get("name") or "New Folder"
                parent_id = args.get("parentId")
                json_: dict[str, Any] = {"name": name, "mimeType": "application/vnd.google-apps.folder"}
                if parent_id:
                    json_["parents"] = [parent_id]
                data = await drive("/files", method="POST", json_=json_)
                return {
                    "ok": True,
                    "folderId": data.get("id"),
                    "link": data.get("webViewLink"),
                    "message": f'Folder "{name}" created in Drive.',
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="drive-createFolder",
                risk=WRITE,
                title=f"Create folder: {args.get('name') or 'New Folder'}",
                preview=f"Folder name: {args.get('name') or 'New Folder'}",
                confirm_text="Create folder",
            ),
            args,
            run,
        )

    return {
        "drive-getStorageQuota": ConnectorTool(
            name="drive-getStorageQuota",
            description="Get the user's current Google Drive storage quota and usage information.",
            parameters=_spec({}),
            execute=get_storage_quota,
        ),
        "drive-searchFiles": ConnectorTool(
            name="drive-searchFiles",
            description="Search the user's Google Drive for files by name.",
            parameters=_spec(
                {
                    "search": {"type": "string", "description": "Comma-separated search terms to match against file names"},
                    "maxResults": {"type": "integer", "description": "Maximum number of results"},
                },
                ["search"],
            ),
            execute=search_files,
        ),
        "drive-listFiles": ConnectorTool(
            name="drive-listFiles",
            description="List files in the user's Google Drive.",
            parameters=_spec(
                {
                    "parentId": {"type": "string", "description": "Folder ID to list; omit for root"},
                    "sortBy": {"type": "string", "enum": ["name", "time"], "description": "Sort field"},
                    "reverse": {"type": "boolean", "description": "Reverse the sort order"},
                    "maxResults": {"type": "integer", "description": "Maximum number of files to return"},
                },
            ),
            execute=list_files,
        ),
        "drive-getFile": ConnectorTool(
            name="drive-getFile",
            description="Get metadata for a file or folder in Google Drive by its ID.",
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID or URL"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=get_file,
        ),
        "drive-readFile": ConnectorTool(
            name="drive-readFile",
            description=(
                "Read the contents of a file in Google Drive. Supports text files, Google Docs "
                "(plain text), and Google Sheets (values). For binary files it returns the Drive "
                "link instead."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=read_file,
        ),
        "drive-createFile": ConnectorTool(
            name="drive-createFile",
            description=(
                "Create a new file in the user's Google Drive with the given content. The system "
                "holds the action for user approval automatically — do not ask the user to confirm."
            ),
            parameters=_spec(
                {
                    "filename": {"type": "string", "description": "Name of the file to create"},
                    "name": {"type": "string", "description": "Alias for filename"},
                    "content": {"type": "string", "description": "Text content to put in the file"},
                    "mimeType": {"type": "string", "description": "MIME type of the file (default text/plain)"},
                    "parentId": {"type": "string", "description": "Folder ID to create the file in"},
                    "parents": {"type": "string", "description": "Alias for parentId"},
                },
                ["filename"],
            ),
            execute=create_file,
        ),
        "drive-listSheetTabs": ConnectorTool(
            name="drive-listSheetTabs",
            description="List all sheet/tab names in a Google Spreadsheet by file ID.",
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Sheets file ID"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=list_sheet_tabs,
        ),
        "drive-readSheet": ConnectorTool(
            name="drive-readSheet",
            description=(
                "Read values from a Google Sheet. By default reads the first tab. Set headerMode "
                "to return each row as an object keyed by the header row."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Sheets file ID"},
                    "sheet": {"type": "string", "description": "Tab name or index (default: first tab)"},
                    "headerMode": {"type": "boolean", "description": "Return rows as header-keyed objects"},
                    "rangeOverride": {"type": "string", "description": "Explicit A1 range override"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=read_sheet,
        ),
        "drive-appendSheetRows": ConnectorTool(
            name="drive-appendSheetRows",
            description=(
                "Append rows to a Google Sheet. Pass CSV text; the first line is the header and "
                "remaining lines are values. The system holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Sheets file ID"},
                    "csvContent": {"type": "string", "description": "CSV content: header on first line, rows after"},
                    "sheet": {"type": "string", "description": "Tab name (default: Sheet1)"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "csvContent"],
            ),
            execute=append_sheet_rows,
        ),
        "drive-updateSheetRange": ConnectorTool(
            name="drive-updateSheetRange",
            description=(
                "Write values to a range in a Google Sheet. Pass CSV text; optionally startRow to "
                "set where writing begins. The system holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Sheets file ID"},
                    "csvContent": {"type": "string", "description": "CSV content: header on first line, rows after"},
                    "sheet": {"type": "string", "description": "Tab name (default: Sheet1)"},
                    "startRow": {"type": "integer", "description": "1-indexed row to start writing at (default 1)"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "csvContent"],
            ),
            execute=update_sheet_range,
        ),
        "drive-appendToDoc": ConnectorTool(
            name="drive-appendToDoc",
            description=(
                "Append content to a Google Doc. Content can be plain text or Markdown. The system "
                "holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Docs file ID"},
                    "content": {"type": "string", "description": "Text or Markdown content to append"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "content"],
            ),
            execute=append_to_doc,
        ),
        "drive-replaceInDoc": ConnectorTool(
            name="drive-replaceInDoc",
            description=(
                "Replace all occurrences of a text string in a Google Doc. The system holds the "
                "action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Docs file ID"},
                    "findText": {"type": "string", "description": "Text to find"},
                    "replaceText": {"type": "string", "description": "Replacement text"},
                    "matchCase": {"type": "boolean", "description": "Case-sensitive match"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "findText", "replaceText"],
            ),
            execute=replace_in_doc,
        ),
        "drive-updateFile": ConnectorTool(
            name="drive-updateFile",
            description=(
                "Update a Drive file's metadata: rename, change description, move between parents, "
                "or star it. The system holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID"},
                    "name": {"type": "string", "description": "New file name"},
                    "description": {"type": "string", "description": "New description"},
                    "addParents": {"type": "string", "description": "Folder ID to add as parent"},
                    "removeParents": {"type": "string", "description": "Folder ID to remove from parents"},
                    "stars": {"type": "boolean", "description": "Star or unstar the file"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=update_file,
        ),
        "drive-deleteFile": ConnectorTool(
            name="drive-deleteFile",
            description=(
                "Delete a file from Google Drive. IMPORTANT: this permanently removes the file; "
                "the system holds the action for explicit user approval."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=delete_file,
        ),
        "drive-shareFile": ConnectorTool(
            name="drive-shareFile",
            description=(
                "Share a Drive file with someone by email. Use format role@email, e.g. "
                "'writer@alice@example.com' (roles: reader, writer, commenter, owner). The system "
                "holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID"},
                    "share": {"type": "string", "description": "role@email, e.g. writer@friend@example.com"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "share"],
            ),
            execute=share_file,
        ),
        "drive-copyFile": ConnectorTool(
            name="drive-copyFile",
            description=(
                "Make a copy of a Google Drive file. Optionally give the copy a new name. The "
                "system holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID to copy"},
                    "name": {"type": "string", "description": "Name for the copy"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId"],
            ),
            execute=copy_file,
        ),
        "drive-convertFile": ConnectorTool(
            name="drive-convertFile",
            description=(
                "Convert a Google-named file (doc/sheet/slides/pdf) to a downloadable Office "
                "format. Targets: gdoc (Word), gsheet (Excel), gslides (PowerPoint), gpdf (PDF), "
                "doc (PDF). The system holds the action for approval automatically."
            ),
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID to convert"},
                    "target": {"type": "string", "enum": ["gdoc", "gsheet", "gslides", "gpdf", "doc"], "description": "Target export format"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
                ["fileId", "target"],
            ),
            execute=convert_file,
        ),
        "drive-listPermissions": ConnectorTool(
            name="drive-listPermissions",
            description="List who has access to a Google Drive file and their roles.",
            parameters=_spec(
                {
                    "fileId": {"type": "string", "description": "Google Drive file ID"},
                    "id": {"type": "string", "description": "Alias for fileId"},
                },
            ),
            execute=list_permissions,
        ),
        "drive-createFolder": ConnectorTool(
            name="drive-createFolder",
            description=(
                "Create a new folder in Google Drive. The system holds the action for approval "
                "automatically."
            ),
            parameters=_spec(
                {
                    "name": {"type": "string", "description": "Name of the folder to create"},
                    "parentId": {"type": "string", "description": "Folder to create within"},
                },
                ["name"],
            ),
            execute=create_folder,
        ),
    }


google_drive_def: ConnectorDef = ConnectorDef(
    id="google-drive",
    name="Google Drive",
    category="productivity",
    icon="google-drive",
    description=(
        "Read, search, create, and manage files in Google Drive, including Google Docs, Sheets, "
        "and Slides."
    ),
    tools=create_drive_tools,
)