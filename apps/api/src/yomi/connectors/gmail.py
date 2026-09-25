"""Google Gmail connector.

Ported from `packages/agent-core/src/connectors/google-gmail.ts` and its
`google-gmail-def.ts`. Provider key in `mcp_connections` is `google`. Exposes 20
tools: search/read/list (read) plus send/write tools gated through `gate_write`.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from yomi.connectors.base import (
    SEND,
    WRITE,
    ConnectorContext,
    ConnectorDef,
    ConnectorError,
    ConnectorTool,
    connector_error,
    gate_write,
)

_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me"


def _b64url_decode(data: str) -> bytes:
    padded = data.replace("-", "+").replace("_", "/")
    return base64.b64decode(padded + "=" * (-len(padded) % 4))


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _decode_body(data: str) -> str:
    if not data:
        return ""
    return _b64url_decode(data).decode("utf-8", errors="replace")


def _extract_text(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        return _decode_body(payload["body"]["data"])
    for part in payload.get("parts", []):
        text = _extract_text(part)
        if text:
            return text
    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
        return re.sub(r"<[^>]+>", "", _decode_body(payload["body"]["data"]))
    return ""


def _extract_html(payload: dict) -> str | None:
    if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
        return _decode_body(payload["body"]["data"])
    for part in payload.get("parts", []):
        html = _extract_html(part)
        if html:
            return html
    return None


def _extract_attachments(payload: dict) -> list[dict]:
    out: list[dict] = []

    def walk(part: dict) -> None:
        body = part.get("body") or {}
        att_id = body.get("attachmentId")
        filename = part.get("filename")
        if att_id and filename:
            out.append(
                {
                    "attachmentId": att_id,
                    "filename": filename,
                    "mimeType": part.get("mimeType") or "application/octet-stream",
                    "size": body.get("size"),
                }
            )
        for child in part.get("parts", []):
            walk(child)

    walk(payload)
    return out


def _header(headers: list[dict], name: str) -> str:
    lowered = name.lower()
    for header in headers:
        if header.get("name", "").lower() == lowered:
            return header.get("value", "")
    return ""


def _sanitize_header_value(value: str) -> str:
    return re.sub(r"[\r\n]+", " ", value).strip()


def _header_list(headers: list[dict], name: str) -> list[str]:
    val = _header(headers, name)
    if not val:
        return []
    return [s.strip() for s in val.split(",") if s.strip()]


def _epoch_ms_iso(internal: str | None) -> str:
    try:
        return datetime.fromtimestamp(int(internal) / 1000, tz=UTC).isoformat()
    except (TypeError, ValueError):
        return ""


def _format_email(email: dict) -> str:
    status = "" if email["isRead"] else " [UNREAD]"
    return (
        f"ID: {email['id']}{status}\nFrom: {email['from']}\nDate: {email['date']}\n"
        f"Subject: {email['subject']}\nPreview: {email['snippet']}"
    )


def _compose_plain_email(
    *,
    to: list[str],
    subject: str,
    body: str,
    cc: list[str] | None = None,
    bcc: list[str] | None = None,
    in_reply_to: str = "",
    references: str = "",
) -> str:
    lines: list[str] = [f"To: {', '.join(_sanitize_header_value(a) for a in to)}"]
    if cc:
        lines.append(f"Cc: {', '.join(_sanitize_header_value(a) for a in cc)}")
    if bcc:
        lines.append(f"Bcc: {', '.join(_sanitize_header_value(a) for a in bcc)}")
    lines.append(f"Subject: {_sanitize_header_value(subject)}")
    if in_reply_to:
        lines.append(f"In-Reply-To: {in_reply_to}")
    if references:
        lines.append(f"References: {references}")
    lines.extend(["MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body])
    return "\r\n".join(lines)


def _find_attachment(payload: dict, attachment_id: str) -> dict:
    if payload.get("body", {}).get("attachmentId"):
        for part in payload.get("parts", []):
            if part.get("body", {}).get("attachmentId") == attachment_id:
                return part
        return {}
    for part in payload.get("parts", []):
        found = _find_attachment(part, attachment_id)
        if found:
            return found
    return {}


def _gate_meta(*, action: str, risk: str, title: str, preview: str, confirm_text: str) -> dict:
    return {
        "connector": "google",
        "action": action,
        "risk": risk,
        "title": title,
        "preview": preview,
        "confirm_text": confirm_text,
    }


class GoogleGmailConnector:
    provider = "google"
    display_name = "Google Gmail"

    def __init__(self, ctx: ConnectorContext):
        self._ctx = ctx

    async def _gmail(
        self,
        path: str,
        *,
        method: str = "GET",
        json_: Any = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        token = await self._ctx.get_access_token(self._ctx.user_id, "google")
        headers = {"Authorization": f"Bearer {token}"}
        if json_ is not None:
            headers["Content-Type"] = "application/json"
        async with httpx.AsyncClient(timeout=30) as client:
            res = await client.request(
                method, f"{_GMAIL_BASE}{path}", headers=headers, json=json_, params=params
            )
        if res.status_code >= 400:
            raise ConnectorError(f"Gmail API {path} → {res.status_code}: {res.text[:200]}")
        if res.status_code == 204 or not res.text:
            return None
        return res.json()

    def _message_summary(self, msg: dict) -> dict:
        hdrs = (msg.get("payload") or {}).get("headers") or []
        labels = list(msg.get("labelIds") or [])
        return {
            "id": msg.get("id"),
            "threadId": msg.get("threadId"),
            "subject": _header(hdrs, "Subject") or "(no subject)",
            "from": _header(hdrs, "From") or "",
            "date": _header(hdrs, "Date") or _epoch_ms_iso(msg.get("internalDate")),
            "snippet": msg.get("snippet") or "",
            "isRead": "UNREAD" not in labels,
            "labels": [label for label in labels if label not in ("INBOX", "UNREAD")],
        }

    def _message_detail(self, msg: dict) -> dict:
        payload = msg.get("payload") or {}
        hdrs = payload.get("headers") or []
        labels = list(msg.get("labelIds") or [])
        return {
            "id": msg.get("id"),
            "threadId": msg.get("threadId"),
            "subject": _header(hdrs, "Subject") or "(no subject)",
            "from": _header(hdrs, "From") or "",
            "to": _header_list(hdrs, "To"),
            "cc": _header_list(hdrs, "Cc"),
            "bcc": _header_list(hdrs, "Bcc"),
            "date": _header(hdrs, "Date") or _epoch_ms_iso(msg.get("internalDate")),
            "snippet": msg.get("snippet") or "",
            "isRead": "UNREAD" not in labels,
            "labels": [label for label in labels if label not in ("INBOX", "UNREAD")],
            "body": _extract_text(payload),
            "htmlBody": _extract_html(payload),
            "attachments": _extract_attachments(payload),
        }

    async def search_emails(self, query: str, limit: int = 10) -> list[dict]:
        data = await self._gmail(
            "/messages", params={"q": query, "maxResults": str(min(limit, 20))}
        )
        entries = (data or {}).get("messages") or []
        return [
            self._message_summary(await self._gmail(f"/messages/{m['id']}?format=metadata"))
            for m in entries[:limit]
        ]

    async def read_email(self, message_id: str) -> dict:
        msg = await self._gmail(f"/messages/{message_id}?format=full")
        return self._message_detail(msg)

    async def get_unread_emails(self, limit: int = 10) -> list[dict]:
        return await self.search_emails("is:unread in:inbox", limit)

    async def summarize_emails_raw(self, message_ids: list[str]) -> list[dict]:
        return [await self.read_email(message_id) for message_id in message_ids]

    async def _modify_message(
        self, message_id: str, add_label_ids: list[str] | None = None,
        remove_label_ids: list[str] | None = None,
    ) -> None:
        await self._gmail(
            f"/messages/{message_id}/modify",
            method="POST",
            json_={"addLabelIds": add_label_ids or [], "removeLabelIds": remove_label_ids or []},
        )

    async def mark_as_read(self, message_id: str) -> None:
        await self._modify_message(message_id, remove_label_ids=["UNREAD"])

    async def mark_as_unread(self, message_id: str) -> None:
        await self._modify_message(message_id, add_label_ids=["UNREAD"])

    async def archive_email(self, message_id: str) -> None:
        await self._modify_message(message_id, remove_label_ids=["INBOX"])

    async def trash_email(self, message_id: str) -> None:
        await self._gmail(f"/messages/{message_id}/trash", method="POST")

    async def reply_to_thread(self, reply: dict) -> dict:
        orig = await self._gmail(f"/messages/{reply['messageId']}?format=metadata")
        hdrs = (orig.get("payload") or {}).get("headers") or []
        orig_message_id = _sanitize_header_value(_header(hdrs, "Message-ID"))
        orig_subject = _sanitize_header_value(_header(hdrs, "Subject"))
        subject = (
            orig_subject if re.match(r"^re:", orig_subject, re.IGNORECASE) else f"Re: {orig_subject}"
        )
        to = _sanitize_header_value(_header(hdrs, "Reply-To") or _header(hdrs, "From"))
        if not to:
            raise ConnectorError("Original message has no sender to reply to")
        references = " ".join(
            part
            for part in (_sanitize_header_value(_header(hdrs, "References")), orig_message_id)
            if part
        )
        if not orig.get("threadId"):
            raise ConnectorError("Original message has no threadId")
        raw = _compose_plain_email(
            to=[to],
            subject=subject,
            body=reply.get("body", ""),
            cc=reply.get("cc"),
            bcc=reply.get("bcc"),
            in_reply_to=orig_message_id,
            references=references,
        )
        sent = await self._gmail(
            "/messages/send",
            method="POST",
            json_={"raw": _b64url_encode(raw.encode("utf-8")), "threadId": orig["threadId"]},
        )
        return {
            "messageId": sent.get("id"),
            "threadId": sent.get("threadId"),
            "to": to,
            "subject": subject,
        }

    async def get_thread(self, thread_id: str) -> dict:
        thread = await self._gmail(f"/threads/{thread_id}?format=full")
        return {
            "id": thread.get("id"),
            "messages": [self._message_detail(msg) for msg in thread.get("messages") or []],
        }

    async def list_labels(self) -> list[dict]:
        data = await self._gmail("/labels")
        return [
            {"id": label.get("id"), "name": label.get("name"), "type": label.get("type")}
            for label in (data or {}).get("labels") or []
        ]

    async def apply_labels(
        self, message_id: str, add_label_ids: list[str], remove_label_ids: list[str]
    ) -> None:
        await self._modify_message(message_id, add_label_ids, remove_label_ids)

    async def create_draft(self, draft: dict) -> dict:
        raw = _compose_plain_email(
            to=draft.get("to", []),
            subject=draft.get("subject", ""),
            body=draft.get("body", ""),
            cc=draft.get("cc"),
            bcc=draft.get("bcc"),
        )
        body: dict[str, Any] = {"message": {"raw": _b64url_encode(raw.encode("utf-8"))}}
        if draft.get("replyToMessageId"):
            try:
                orig = await self._gmail(f"/messages/{draft['replyToMessageId']}?format=metadata")
                body["message"]["threadId"] = orig.get("threadId")
            except ConnectorError:
                pass  # best-effort threading hint
        result = await self._gmail("/drafts", method="POST", json_=body)
        return {"id": result.get("id"), "messageId": (result.get("message") or {}).get("id")}

    async def get_attachment(self, message_id: str, attachment_id: str) -> dict:
        msg = await self._gmail(f"/messages/{message_id}?format=full")
        part = _find_attachment(msg.get("payload") or {}, attachment_id)
        att = await self._gmail(f"/messages/{message_id}/attachments/{attachment_id}")
        return {
            "filename": (part or {}).get("filename") or "attachment",
            "mimeType": (part or {}).get("mimeType") or "application/octet-stream",
            "data": att.get("data"),
            "size": att.get("size"),
        }

    async def list_drafts(self) -> list[dict]:
        data = await self._gmail("/drafts")
        out: list[dict] = []
        for draft in (data or {}).get("drafts") or []:
            try:
                detail = await self._gmail(f"/drafts/{draft['id']}?format=metadata")
                hdrs = (detail.get("payload") or {}).get("headers") or []
                out.append(
                    {
                        "id": draft.get("id"),
                        "messageId": detail.get("id"),
                        "subject": _header(hdrs, "Subject") or "(no subject)",
                        "from": _header(hdrs, "From") or "",
                        "date": _header(hdrs, "Date") or _epoch_ms_iso(detail.get("internalDate")),
                    }
                )
            except ConnectorError:
                out.append(
                    {
                        "id": draft.get("id"),
                        "messageId": (draft.get("message") or {}).get("id"),
                        "subject": "(unknown)",
                        "from": "",
                        "date": "",
                    }
                )
        return out

    async def send_draft(self, draft_id: str) -> dict:
        result = await self._gmail("/drafts/send", method="POST", json_={"id": draft_id})
        message = result.get("message") or {}
        return {"messageId": message.get("id"), "threadId": message.get("threadId")}

    async def create_label(self, name: str) -> dict:
        label = await self._gmail(
            "/labels",
            method="POST",
            json_={
                "name": name,
                "labelListVisibility": "labelShow",
                "messageListVisibility": "show",
            },
        )
        return {"id": label.get("id"), "name": label.get("name"), "type": label.get("type")}

    async def send_email(self, draft: dict) -> dict:
        raw = _compose_plain_email(
            to=draft.get("to", []),
            subject=draft.get("subject", ""),
            body=draft.get("body", ""),
            cc=draft.get("cc"),
            bcc=draft.get("bcc"),
        )
        body: dict[str, Any] = {"raw": _b64url_encode(raw.encode("utf-8"))}
        if draft.get("replyToMessageId"):
            try:
                orig = await self._gmail(f"/messages/{draft['replyToMessageId']}?format=metadata")
                body["threadId"] = orig.get("threadId")
            except ConnectorError:
                pass  # best-effort threading hint
        sent = await self._gmail("/messages/send", method="POST", json_=body)
        return {"messageId": sent.get("id"), "threadId": sent.get("threadId")}


def _spec(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or []}


def create_gmail_tools(ctx: ConnectorContext) -> dict[str, ConnectorTool]:
    """Build the 20 Gmail tools bound to this user's context."""
    gmail = GoogleGmailConnector(ctx)

    async def search_emails(args: dict) -> dict:
        try:
            emails = await gmail.search_emails(args["query"], int(args.get("limit") or 10))
            if not emails:
                return {"results": [], "message": "No emails found."}
            return {"results": emails, "formatted": "\n\n".join(_format_email(e) for e in emails)}
        except Exception as err:
            return connector_error(err)

    async def read_email(args: dict) -> dict:
        try:
            email = await gmail.read_email(args["messageId"])
            return {
                "id": email["id"],
                "subject": email["subject"],
                "from": email["from"],
                "to": email["to"],
                "cc": email["cc"],
                "date": email["date"],
                "body": email["body"][:8000],
                "isRead": email["isRead"],
                "labels": email["labels"],
                "attachments": email["attachments"],
            }
        except Exception as err:
            return connector_error(err)

    async def get_unread_emails(args: dict) -> dict:
        try:
            emails = await gmail.get_unread_emails(int(args.get("limit") or 10))
            if not emails:
                return {"emails": [], "message": "Inbox is clear — no unread emails."}
            return {"count": len(emails), "emails": emails, "formatted": "\n\n".join(_format_email(e) for e in emails)}
        except Exception as err:
            return connector_error(err)

    async def get_important_emails(args: dict) -> dict:
        try:
            query = (
                "is:important is:unread in:inbox"
                if args.get("unreadOnly")
                else "is:important in:inbox"
            )
            emails = await gmail.search_emails(query, int(args.get("limit") or 10))
            if not emails:
                return {"emails": [], "message": "No important emails found in the inbox."}
            ranked = sorted(emails, key=lambda e: int(e["isRead"]))
            return {
                "count": len(ranked),
                "emails": ranked,
                "formatted": "\n\n".join(_format_email(e) for e in ranked),
            }
        except Exception as err:
            return connector_error(err)

    async def summarize_emails(args: dict) -> dict:
        try:
            message_ids = args.get("messageIds")
            if not message_ids:
                unread = await gmail.get_unread_emails(int(args.get("limit") or 5))
                message_ids = [email["id"] for email in unread]
            if not message_ids:
                return {"emails": [], "message": "No emails to summarize."}
            emails = await gmail.summarize_emails_raw(message_ids)
            return {
                "emails": [
                    {
                        "id": email["id"],
                        "subject": email["subject"],
                        "from": email["from"],
                        "date": email["date"],
                        "body": email["body"][:3000],
                    }
                    for email in emails
                ]
            }
        except Exception as err:
            return connector_error(err)

    async def send_email(args: dict) -> dict:
        recipients = ", ".join(args.get("to", []))
        if ctx.create_pending_action is not None:
            preview = "\n".join(
                part
                for part in (
                    f"To: {recipients}",
                    f"Cc: {', '.join(args['cc'])}" if args.get("cc") else None,
                    f"Bcc: {', '.join(args['bcc'])}" if args.get("bcc") else None,
                    f"Subject: {args.get('subject')}",
                    "",
                    str(args.get("body", ""))[:1200],
                )
                if part is not None
            )
            return await ctx.create_pending_action(
                _gate_meta(
                    action="gmail-sendEmail",
                    risk=SEND,
                    title=f"Send email to {recipients}",
                    preview=preview,
                    confirm_text="Send email",
                )
                | {"payload": args}
            )
        try:
            result = await gmail.send_email(args)
            return {
                "ok": True,
                "messageId": result["messageId"],
                "threadId": result["threadId"],
                "message": f'Email sent to {recipients} with subject "{args.get("subject")}".',
            }
        except Exception as err:
            return connector_error(err)

    async def reply_to_thread(args: dict) -> dict:
        reply_target = f"message {args['messageId']}"
        try:
            orig = await gmail.read_email(args["messageId"])
            reply_target = f'{orig["from"]} — "{orig["subject"]}"'
        except Exception:
            pass  # best-effort sender/subject lookup for the preview

        async def run() -> dict:
            try:
                result = await gmail.reply_to_thread(args)
                return {
                    "ok": True,
                    "messageId": result["messageId"],
                    "threadId": result["threadId"],
                    "message": f'Reply sent to {result["to"]} in thread "{result["subject"]}".',
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-replyToThread",
                risk=SEND,
                title=f"Send reply to {reply_target}",
                preview=f"Reply to: {reply_target}\n\n{str(args.get('body', ''))[:1200]}",
                confirm_text="Send reply",
            ),
            args,
            run,
        )

    async def mark_as_read(args: dict) -> dict:
        async def run() -> dict:
            try:
                await gmail.mark_as_read(args["messageId"])
                return {"ok": True, "message": f"Message {args['messageId']} marked as read."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-markAsRead",
                risk=WRITE,
                title="Mark email as read",
                preview=f"Mark message {args['messageId']} as read",
                confirm_text="Mark as read",
            ),
            args,
            run,
        )

    async def mark_as_unread(args: dict) -> dict:
        async def run() -> dict:
            try:
                await gmail.mark_as_unread(args["messageId"])
                return {"ok": True, "message": f"Message {args['messageId']} marked as unread."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-markAsUnread",
                risk=WRITE,
                title="Mark email as unread",
                preview=f"Mark message {args['messageId']} as unread",
                confirm_text="Mark as unread",
            ),
            args,
            run,
        )

    async def archive_email(args: dict) -> dict:
        async def run() -> dict:
            try:
                await gmail.archive_email(args["messageId"])
                return {"ok": True, "message": f"Message {args['messageId']} archived."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-archiveEmail",
                risk=WRITE,
                title="Archive email",
                preview=f"Archive message {args['messageId']} (removes from inbox)",
                confirm_text="Archive",
            ),
            args,
            run,
        )

    async def trash_email(args: dict) -> dict:
        async def run() -> dict:
            try:
                await gmail.trash_email(args["messageId"])
                return {"ok": True, "message": f"Message {args['messageId']} moved to trash."}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-trashEmail",
                risk=WRITE,
                title="Trash email",
                preview=f"Move message {args['messageId']} to trash",
                confirm_text="Move to trash",
            ),
            args,
            run,
        )

    async def get_thread(args: dict) -> dict:
        try:
            thread = await gmail.get_thread(args["threadId"])
            return {
                "threadId": thread["id"],
                "messageCount": len(thread["messages"]),
                "messages": [
                    {
                        "id": message["id"],
                        "subject": message["subject"],
                        "from": message["from"],
                        "to": message["to"],
                        "date": message["date"],
                        "body": message["body"][:4000],
                        "isRead": message["isRead"],
                        "labels": message["labels"],
                    }
                    for message in thread["messages"]
                ],
            }
        except Exception as err:
            return connector_error(err)

    async def list_labels(args: dict) -> dict:
        try:
            labels = await gmail.list_labels()
            return {
                "count": len(labels),
                "labels": [{"id": label["id"], "name": label["name"], "type": label["type"]} for label in labels],
            }
        except Exception as err:
            return connector_error(err)

    async def apply_labels(args: dict) -> dict:
        async def run() -> dict:
            try:
                await gmail.apply_labels(
                    args["messageId"], args.get("addLabelIds") or [], args.get("removeLabelIds") or []
                )
                return {"ok": True, "message": f"Labels updated on message {args['messageId']}."}
            except Exception as err:
                return connector_error(err)

        preview = "\n".join(
            part
            for part in (
                f"Message: {args['messageId']}",
                f"Add labels: {', '.join(args['addLabelIds'])}" if args.get("addLabelIds") else None,
                f"Remove labels: {', '.join(args['removeLabelIds'])}" if args.get("removeLabelIds") else None,
            )
            if part is not None
        )
        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-applyLabels",
                risk=WRITE,
                title="Apply labels to message",
                preview=preview,
                confirm_text="Apply labels",
            ),
            args,
            run,
        )

    async def get_attachment(args: dict) -> dict:
        try:
            att = await gmail.get_attachment(args["messageId"], args["attachmentId"])
            return {
                "filename": att["filename"],
                "mimeType": att["mimeType"],
                "size": att["size"],
                "data": str(att.get("data", ""))[:500000],
                "truncated": len(str(att.get("data", ""))) > 500000,
            }
        except Exception as err:
            return connector_error(err)

    async def save_attachment_to_drive(args: dict) -> dict:
        async def run() -> dict:
            try:
                try:
                    drive_token = await ctx.get_access_token(ctx.user_id, "google-drive")
                except ConnectorError:
                    return {
                        "error": "Google Drive is not connected",
                        "hint": "Ask the user to connect Google Drive via the Integrations tab, then retry.",
                    }
                try:
                    att = await gmail.get_attachment(args["messageId"], args["attachmentId"])
                    data = _b64url_decode(str(att.get("data", "")))
                    metadata: dict[str, Any] = {"name": args.get("name") or att["filename"]}
                    if args.get("folderId"):
                        metadata["parents"] = [args["folderId"]]
                    boundary = "yomi_attachment_boundary"
                    head = (
                        f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
                        f"{json.dumps(metadata)}\r\n--{boundary}\r\n"
                        f"Content-Type: {att['mimeType']}\r\n\r\n"
                    ).encode()
                    tail = f"\r\n--{boundary}--".encode()
                    url = (
                        "https://www.googleapis.com/upload/drive/v3/files"
                        "?uploadType=multipart&fields=id,name,webViewLink,size"
                    )
                    async with httpx.AsyncClient(timeout=60) as client:
                        res = await client.post(
                            url,
                            headers={
                                "Authorization": f"Bearer {drive_token}",
                                "Content-Type": f"multipart/related; boundary={boundary}",
                            },
                            content=head + data + tail,
                        )
                    if res.status_code >= 400:
                        raise ConnectorError(f"Drive upload failed: {res.status_code}: {res.text}")
                    file = res.json()
                    return {
                        "ok": True,
                        "id": file.get("id"),
                        "name": file.get("name"),
                        "link": file.get("webViewLink"),
                        "message": f'Attachment saved to Drive as "{file.get("name")}".',
                    }
                except Exception as err:
                    return connector_error(err)
            except Exception as err:
                return connector_error(err)

        preview = (
            f"Save attachment {args.get('attachmentId')} from message {args.get('messageId')} "
            f"to Google Drive"
        )
        if args.get("name"):
            preview += f' as "{args["name"]}"'
        if args.get("folderId"):
            preview += f" in folder {args['folderId']}"
        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-saveAttachmentToDrive",
                risk=WRITE,
                title="Save Gmail attachment to Drive",
                preview=preview,
                confirm_text="Save to Drive",
            ),
            args,
            run,
        )

    async def list_drafts(args: dict) -> dict:
        try:
            drafts = await gmail.list_drafts()
            if not drafts:
                return {"drafts": [], "message": "No drafts found."}
            return {"count": len(drafts), "drafts": drafts}
        except Exception as err:
            return connector_error(err)

    async def send_draft(args: dict) -> dict:
        async def run() -> dict:
            try:
                result = await gmail.send_draft(args["draftId"])
                return {
                    "ok": True,
                    "messageId": result["messageId"],
                    "threadId": result["threadId"],
                    "message": "Draft sent.",
                }
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-sendDraft",
                risk=SEND,
                title="Send email draft",
                preview=f"Send draft {args['draftId']}",
                confirm_text="Send draft",
            ),
            args,
            run,
        )

    async def create_label(args: dict) -> dict:
        async def run() -> dict:
            try:
                result = await gmail.create_label(args["name"])
                return {"ok": True, "id": result["id"], "name": result["name"]}
            except Exception as err:
                return connector_error(err)

        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-createLabel",
                risk=WRITE,
                title=f"Create Gmail label: {args['name']}",
                preview=f'Create label "{args["name"]}"',
                confirm_text="Create label",
            ),
            args,
            run,
        )

    async def create_draft(args: dict) -> dict:
        async def run() -> dict:
            try:
                result = await gmail.create_draft(args)
                return {"ok": True, "draftId": result["id"], "messageId": result["messageId"]}
            except Exception as err:
                return connector_error(err)

        preview = "\n".join(
            part
            for part in (
                f"To: {', '.join(args.get('to', []))}",
                f"Cc: {', '.join(args['cc'])}" if args.get("cc") else None,
                f"Bcc: {', '.join(args['bcc'])}" if args.get("bcc") else None,
                f"Subject: {args.get('subject')}",
                "",
                str(args.get("body", ""))[:800],
            )
            if part is not None
        )
        return await gate_write(
            ctx,
            _gate_meta(
                action="gmail-createDraft",
                risk=WRITE,
                title="Create email draft",
                preview=preview,
                confirm_text="Create draft",
            ),
            args,
            run,
        )

    return {
        "gmail-searchEmails": ConnectorTool(
            name="gmail-searchEmails",
            description=(
                "Search Gmail for emails matching a query string (supports Gmail search operators "
                "like from:, subject:, after:, before:, has:attachment). Returns matching emails "
                "with ID, sender, subject, date, and snippet."
            ),
            parameters=_spec(
                {
                    "query": {"type": "string", "description": "Gmail search query"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Max results to return"},
                },
                ["query"],
            ),
            execute=search_emails,
        ),
        "gmail-readEmail": ConnectorTool(
            name="gmail-readEmail",
            description=(
                "Read the full content of a single Gmail message by its ID. Returns the full body, "
                "headers (from, to, cc), metadata, and an `attachments` list. Each attachment carries "
                "the attachmentId that gmail-saveAttachmentToDrive and gmail-getAttachment need — call "
                "this first when the user asks to save or open an attachment."
            ),
            parameters=_spec({"messageId": {"type": "string", "description": "The Gmail message ID"}}),
            execute=read_email,
        ),
        "gmail-getUnreadEmails": ConnectorTool(
            name="gmail-getUnreadEmails",
            description=(
                "Get the most recent unread emails from the Gmail inbox. Returns email summaries "
                "with IDs, senders, subjects, and snippets."
            ),
            parameters=_spec(
                {
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Max unread emails to return"},
                },
            ),
            execute=get_unread_emails,
        ),
        "gmail-getImportantEmails": ConnectorTool(
            name="gmail-getImportantEmails",
            description=(
                "Get the most important recent emails in the Gmail inbox, ranked by Gmail's "
                "importance markers with unread ones first. Use this when the user asks what emails "
                "matter, what needs attention, or wants an inbox briefing."
            ),
            parameters=_spec(
                {
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20, "description": "Max emails to return"},
                    "unreadOnly": {"type": "boolean", "description": "Only include unread important emails"},
                },
            ),
            execute=get_important_emails,
        ),
        "gmail-summarizeEmails": ConnectorTool(
            name="gmail-summarizeEmails",
            description=(
                "Fetch and return the raw content of emails to summarize. Pass specific message IDs, "
                "or leave empty to summarize the last 5 unread emails. Use the returned content to "
                "write a human-friendly summary."
            ),
            parameters=_spec(
                {
                    "messageIds": {"type": "array", "items": {"type": "string"}, "description": "Specific message IDs to summarize"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Unread count when no IDs provided"},
                },
            ),
            execute=summarize_emails,
        ),
        "gmail-sendEmail": ConnectorTool(
            name="gmail-sendEmail",
            description=(
                "Send a NEW email via Gmail. To reply within an existing thread use "
                "gmail-replyToThread instead. If the user named the recipient by name rather than "
                "address ('email Alex'), ask the user for their email address first — never guess an "
                "address. IMPORTANT: confirm the To, Subject, and first 200 chars of body with the "
                "user before calling this tool."
            ),
            parameters=_spec(
                {
                    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipient email addresses"},
                    "subject": {"type": "string", "description": "Email subject line"},
                    "body": {"type": "string", "description": "Plain-text email body"},
                    "cc": {"type": "array", "items": {"type": "string"}, "description": "CC recipients"},
                    "bcc": {"type": "array", "items": {"type": "string"}, "description": "BCC recipients"},
                    "replyToMessageId": {"type": "string", "description": "Gmail message ID to reply to (for threading)"},
                },
                ["to", "subject", "body"],
            ),
            execute=send_email,
        ),
        "gmail-markAsRead": ConnectorTool(
            name="gmail-markAsRead",
            description="Mark a Gmail message as read (removes the UNREAD label).",
            parameters=_spec({"messageId": {"type": "string", "description": "The Gmail message ID"}}),
            execute=mark_as_read,
        ),
        "gmail-markAsUnread": ConnectorTool(
            name="gmail-markAsUnread",
            description="Mark a Gmail message as unread (adds the UNREAD label).",
            parameters=_spec({"messageId": {"type": "string", "description": "The Gmail message ID"}}),
            execute=mark_as_unread,
        ),
        "gmail-archiveEmail": ConnectorTool(
            name="gmail-archiveEmail",
            description=(
                "Archive a Gmail message by removing it from the inbox (removes the INBOX label)."
            ),
            parameters=_spec({"messageId": {"type": "string", "description": "The Gmail message ID"}}),
            execute=archive_email,
        ),
        "gmail-trashEmail": ConnectorTool(
            name="gmail-trashEmail",
            description="Move a Gmail message to the trash.",
            parameters=_spec({"messageId": {"type": "string", "description": "The Gmail message ID"}}),
            execute=trash_email,
        ),
        "gmail-replyToThread": ConnectorTool(
            name="gmail-replyToThread",
            description=(
                "Reply to an email inside its existing thread. Threading headers and the Re: subject "
                "are handled automatically — do NOT pass a subject. Pass the messageId of the message "
                "being replied to (usually the latest in the thread, from gmail-searchEmails, "
                "gmail-getThread, or gmail-readEmail). Confirm the reply body with the user before "
                "calling."
            ),
            parameters=_spec(
                {
                    "messageId": {"type": "string", "description": "Gmail message ID of the message to reply to"},
                    "body": {"type": "string", "description": "Plain-text reply body"},
                    "cc": {"type": "array", "items": {"type": "string"}, "description": "Additional CC recipients"},
                    "bcc": {"type": "array", "items": {"type": "string"}, "description": "BCC recipients"},
                },
                ["messageId", "body"],
            ),
            execute=reply_to_thread,
        ),
        "gmail-getThread": ConnectorTool(
            name="gmail-getThread",
            description=(
                "Fetch all messages in a Gmail thread by threadId. Returns messages in order, each "
                "with full body and headers."
            ),
            parameters=_spec({"threadId": {"type": "string", "description": "The Gmail thread ID"}}),
            execute=get_thread,
        ),
        "gmail-listLabels": ConnectorTool(
            name="gmail-listLabels",
            description=(
                "List all Gmail labels (both system and user-defined) with their ID, name, and type."
            ),
            parameters=_spec({}),
            execute=list_labels,
        ),
        "gmail-applyLabels": ConnectorTool(
            name="gmail-applyLabels",
            description=(
                "Add or remove labels on a Gmail message — this is the tool that actually puts a "
                "message under a label. Get label IDs from gmail-listLabels; if the label does not "
                "exist yet, create it with gmail-createLabel first and pass the id it returns."
            ),
            parameters=_spec(
                {
                    "messageId": {"type": "string", "description": "The Gmail message ID to modify"},
                    "addLabelIds": {"type": "array", "items": {"type": "string"}, "description": "Label IDs to add"},
                    "removeLabelIds": {"type": "array", "items": {"type": "string"}, "description": "Label IDs to remove"},
                },
                ["messageId"],
            ),
            execute=apply_labels,
        ),
        "gmail-getAttachment": ConnectorTool(
            name="gmail-getAttachment",
            description=(
                "Download an attachment from a Gmail message by message ID and attachment ID. Returns "
                "the base64-encoded data, filename, and MIME type. First use gmail-readEmail to "
                "discover attachment IDs from the message body. Prefer gmail-saveAttachmentToDrive to "
                "keep or reuse a file — it saves directly to Google Drive."
            ),
            parameters=_spec(
                {
                    "messageId": {"type": "string", "description": "The Gmail message ID"},
                    "attachmentId": {"type": "string", "description": "The attachment ID (found in the message body parts)"},
                },
                ["messageId", "attachmentId"],
            ),
            execute=get_attachment,
        ),
        "gmail-saveAttachmentToDrive": ConnectorTool(
            name="gmail-saveAttachmentToDrive",
            description=(
                "Save a Gmail attachment directly to the user's Google Drive and return the Drive file "
                "link — the file data never enters the conversation. Prefer this over "
                "gmail-getAttachment whenever the user wants to keep, organize, share, or reuse an "
                "attachment. Requires the Google Drive connector. Find messageId and attachmentId via "
                "gmail-readEmail."
            ),
            parameters=_spec(
                {
                    "messageId": {"type": "string", "description": "The Gmail message ID"},
                    "attachmentId": {"type": "string", "description": "The attachment ID from the message body parts"},
                    "name": {"type": "string", "description": "File name in Drive (defaults to the attachment's own filename)"},
                    "folderId": {"type": "string", "description": "Drive folder ID to save the file into"},
                },
                ["messageId", "attachmentId"],
            ),
            execute=save_attachment_to_drive,
        ),
        "gmail-listDrafts": ConnectorTool(
            name="gmail-listDrafts",
            description=(
                "List all email drafts in Gmail. Returns draft IDs with subject, sender, and date."
            ),
            parameters=_spec({}),
            execute=list_drafts,
        ),
        "gmail-sendDraft": ConnectorTool(
            name="gmail-sendDraft",
            description=(
                "Send an existing Gmail draft by its draft ID. Use gmail-listDrafts first to find "
                "available drafts, then confirm with the user before sending."
            ),
            parameters=_spec({"draftId": {"type": "string", "description": "The draft ID from gmail-listDrafts"}}),
            execute=send_draft,
        ),
        "gmail-createLabel": ConnectorTool(
            name="gmail-createLabel",
            description=(
                "Create a new Gmail label and return its id. The label appears in the sidebar but "
                "starts EMPTY — creating it does not put any message in it. When the user asked to "
                "label a message, check gmail-listLabels first, create the label here only if it does "
                "not already exist, then call gmail-applyLabels to actually label the message."
            ),
            parameters=_spec({"name": {"type": "string", "description": "Name of the new label"}}),
            execute=create_label,
        ),
        "gmail-createDraft": ConnectorTool(
            name="gmail-createDraft",
            description=(
                "Create a draft email in Gmail without sending. Use this to prepare an email for user "
                "review before sending."
            ),
            parameters=_spec(
                {
                    "to": {"type": "array", "items": {"type": "string"}, "description": "Recipient email addresses"},
                    "subject": {"type": "string", "description": "Email subject line"},
                    "body": {"type": "string", "description": "Plain-text email body"},
                    "cc": {"type": "array", "items": {"type": "string"}, "description": "CC recipients"},
                    "bcc": {"type": "array", "items": {"type": "string"}, "description": "BCC recipients"},
                    "replyToMessageId": {"type": "string", "description": "Gmail message ID to reply to (for threading)"},
                },
                ["to", "subject", "body"],
            ),
            execute=create_draft,
        ),
    }


google_gmail_def: ConnectorDef = ConnectorDef(
    id="google",
    name="Google Gmail",
    category="email",
    icon="gmail",
    description="Read, search, and send emails from your Gmail account.",
    tools=create_gmail_tools,
)