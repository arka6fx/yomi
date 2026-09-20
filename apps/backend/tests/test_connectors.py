import uuid

import pytest

from yomi.connectors import (
    SEND,
    ConnectorContext,
    ConnectorError,
    connector_error,
    gate_write,
)
from yomi.connectors.base import WRITE
from yomi.connectors.calendar import event_time_payload
from yomi.connectors.drive import (
    coerce_cell,
    escape_xml,
    markdown_to_html,
    parse_markdown_slides,
    parse_table_content,
    split_overlong_slide,
)
from yomi.connectors.gmail import (
    _b64url_encode,
    _decode_body,
    _extract_attachments,
    _extract_text,
    _sanitize_header_value,
)
from yomi.connectors.pending import create_pending_action
from yomi.connectors.registry import default_registry


def _ctx(creator=None):
    return ConnectorContext(
        user_id="user-1",
        get_access_token=lambda user_id, provider: _dummy_token(),
        create_pending_action=creator,
    )


async def _dummy_token():
    return "ya29.stub"


class TestConnectorErrorHints:
    def test_auth_failure_hints_reconnect(self, monkeypatch):
        monkeypatch.setattr("yomi.connectors.base.settings.app_url", "https://getyomi.in")
        err = ConnectorError("gmail-api /users/me/messages → 401: invalid_token")
        out = connector_error(err)
        assert out["error"]
        assert "getyomi.in/dashboard" in out["hint"]

    def test_notion_permission_hint(self):
        err = ConnectorError("restricted_resource: no access to the database")
        out = connector_error(err)
        assert "Notion" in out["hint"]

    def test_unknown_error_has_no_hint(self):
        out = connector_error(RuntimeError("something odd broke"))
        assert "hint" not in out
        assert "odd broke" in out["error"]


class TestGateWrite:
    @pytest.mark.asyncio
    async def test_queues_when_hook_present(self):
        captured = {}

        async def creator(meta):
            captured.update(meta)
            return {"id": "abc", "status": "pending", "message": "waiting"}

        ctx = _ctx(creator)

        async def run():
            return {"ok": True, "sent": True}

        result = await gate_write(
            ctx,
            {
                "connector": "gmail",
                "action": "gmail-sendEmail",
                "risk": SEND,
                "title": "Send email to bob",
                "preview": "to bob",
                "confirm_text": "Send",
            },
            {"to": "bob@example.com", "subject": "Hi"},
            run,
        )
        assert result["status"] == "pending"
        assert captured["payload"] == {"to": "bob@example.com", "subject": "Hi"}
        assert captured["risk"] == SEND

    @pytest.mark.asyncio
    async def test_runs_immediately_without_hook(self):
        ctx = _ctx(None)

        async def run():
            return {"ok": True}

        result = await gate_write(
            ctx,
            {
                "connector": "gmail",
                "action": "gmail-sendEmail",
                "risk": SEND,
                "title": "Send",
                "preview": "x",
                "confirm_text": "Send",
            },
            {},
            run,
        )
        assert result == {"ok": True}


class TestPendingActionHook:
    @pytest.mark.asyncio
    async def test_creates_durable_row(self):
        pending_rows = []

        class FakeDb:
            def add(self, row):
                pending_rows.append(row)

            async def flush(self):
                row = pending_rows[0]
                row.id = uuid.uuid4()

        db = FakeDb()
        creator = create_pending_action(
            db,
            user_id="some-text-id",
            source_platform="telegram",
            source_chat_id="12345",
            requested_by_run_id=uuid.uuid4(),
        )
        result = await creator(
            {
                "connector": "google-calendar",
                "action": "calendar-createEvent",
                "risk": WRITE,
                "title": "Create event: Standup",
                "preview": "Standup at 9am",
                "confirm_text": "Create event",
                "payload": {"title": "Standup", "start": "2026-07-01T09:00:00"},
            }
        )
        assert result["status"] == "pending"
        row = pending_rows[0]
        assert row.status == "pending"
        assert row.connector == "google-calendar"
        assert row.source_platform == "telegram"
        assert row.payload["title"] == "Standup"
        assert row.expires_at is not None


class TestCalendarEventTime:
    def test_offset_time_passes_through(self):
        assert event_time_payload("2026-07-01T14:00:00Z", "Europe/Berlin") == {
            "dateTime": "2026-07-01T14:00:00Z"
        }
        assert event_time_payload("2026-07-01T14:00:00+02:00", "Europe/Berlin") == {
            "dateTime": "2026-07-01T14:00:00+02:00"
        }

    def test_offsetless_time_uses_user_tz(self):
        assert event_time_payload("2026-07-01T09:00:00", "America/New_York") == {
            "dateTime": "2026-07-01T09:00:00",
            "timeZone": "America/New_York",
        }

    def test_offsetless_time_without_tz(self):
        assert event_time_payload("2026-07-01T09:00:00", None) == {
            "dateTime": "2026-07-01T09:00:00"
        }


class TestGmailHelpers:
    def test_sanitize_header_strips_newlines(self):
        assert _sanitize_header_value("line1\r\nline2") == "line1 line2"

    def test_decode_body_base64url(self):
        assert _decode_body(_b64url_encode(b"hello gmail")) == "hello gmail"
        assert _decode_body("") == ""

    def test_extract_text_prefers_plain(self):
        payload = {
            "mimeType": "multipart/alternative",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": _b64url_encode(b"plain body")}},
                {"mimeType": "text/html", "body": {"data": _b64url_encode(b"<b>html body</b>")}},
            ],
        }
        assert _extract_text(payload) == "plain body"

    def test_extract_attachments_walks_parts(self):
        payload = {
            "mimeType": "multipart/mixed",
            "parts": [
                {"mimeType": "text/plain", "body": {"data": "aGk="}},
                {
                    "mimeType": "application/pdf",
                    "filename": "report.pdf",
                    "body": {"attachmentId": "ATT1", "size": 123},
                },
            ],
        }
        atts = _extract_attachments(payload)
        assert atts == [
            {
                "attachmentId": "ATT1",
                "filename": "report.pdf",
                "mimeType": "application/pdf",
                "size": 123,
            }
        ]


class TestDrivePureHelpers:
    def test_escape_xml(self):
        assert escape_xml("<a>&'\"</a>") == "&lt;a&gt;&amp;&apos;&quot;&lt;/a&gt;"

    def test_markdown_to_html(self):
        md = "# Title\n\n**bold** text with [a link](https://x.example)\n\n- item one\n- item two"
        html = markdown_to_html(md)
        assert "<h1>Title</h1>" in html
        assert "<b>bold</b>" in html
        assert '<a href="https://x.example">a link</a>' in html
        assert "item two" in html and "<li>" in html

    def test_coerce_cell(self):
        assert coerce_cell("  ") is None
        assert coerce_cell("true") is True
        assert coerce_cell("FALSE") is False
        assert coerce_cell("1") is True
        assert coerce_cell("42") == 42
        assert coerce_cell("3.5") == 3.5
        assert coerce_cell("Mr. Smith") == "Mr. Smith"

    def test_parse_table_content(self):
        parsed = parse_table_content("Name,Active,Score\nAlice,true,10\nBob,false,7.5\n", "read")
        assert parsed["api"] == "read"
        assert parsed["header"] == ["Name", "Active", "Score"]
        assert parsed["rows"] == [
            ["Alice", True, 10],
            ["Bob", False, 7.5],
        ]

    def test_parse_markdown_slides_splits_on_delimiter(self):
        slides = parse_markdown_slides("# Intro\nWelcome\n\n---\n\n## Details\n- a\n- b")
        assert len(slides) == 2
        assert slides[0] == {"title": "Intro", "body": ["Welcome"], "header": True}
        assert slides[1] == {"title": "Details", "body": ["- a", "- b"], "header": True}

    def test_split_overlong_slide_max_lines(self):
        long_slide = {"title": "T", "body": [f"line {i}" for i in range(30)], "header": True}
        parts = split_overlong_slide(long_slide)
        assert all(len(p["body"]) <= 9 for p in parts)
        total = sum(len(p["body"]) for p in parts)
        assert total == 30

    def test_split_overlong_slide_max_chars(self):
        long_line = "x" * 200
        slide = {"title": "T", "body": [long_line, long_line], "header": False}
        parts = split_overlong_slide(slide)
        assert all(sum(len(line) for line in part["body"]) <= 520 for part in parts)


class TestRegistry:
    class _FakeScalars:
        def __init__(self, values):
            self._values = values

        def __iter__(self):
            return iter(self._values)

    class _FakeResult:
        def __init__(self, values):
            self._values = values

        def scalars(self):
            return TestRegistry._FakeScalars(self._values)

    class _FakeDb:
        def __init__(self, providers, fail=False):
            self._providers = providers
            self._fail = fail

        async def execute(self, statement):
            if self._fail:
                raise AssertionError("db should not be queried for non-uuid ids")
            return TestRegistry._FakeResult(list(self._providers))

    @pytest.mark.asyncio
    async def test_non_uuid_user_gets_no_connector_tools(self):
        db = self._FakeDb([], fail=True)
        tools = await default_registry.tools_for_user(db, "12345")
        assert tools == {}

    @pytest.mark.asyncio
    async def test_connected_provider_surfaces_its_tools(self):
        db = self._FakeDb(["google"])
        tools = await default_registry.tools_for_user(db, str(uuid.uuid4()))
        assert len(tools) == 20
        assert all(name.startswith("gmail-") for name in tools)
        spec = tools["gmail-sendEmail"].to_openai_spec()
        assert spec["type"] == "function"
        assert spec["function"]["name"] == "gmail-sendEmail"

    @pytest.mark.asyncio
    async def test_all_three_google_connectors(self):
        db = self._FakeDb(["google", "google-calendar", "google-drive"])
        tools = await default_registry.tools_for_user(db, str(uuid.uuid4()))
        google_counts = {
            "gmail": sum(1 for name in tools if name.startswith("gmail-")),
            "calendar": sum(1 for name in tools if name.startswith("calendar-")),
            "drive": sum(1 for name in tools if name.startswith("drive-")),
        }
        assert google_counts == {"gmail": 20, "calendar": 10, "drive": 19}
        assert len(tools) == 49

    @pytest.mark.asyncio
    async def test_unknown_provider_is_ignored(self):
        db = self._FakeDb(["google", "myspace"])
        tools = await default_registry.tools_for_user(db, str(uuid.uuid4()))
        assert len(tools) == 20