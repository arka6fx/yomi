"""Connected-app actions stay out of the prompt and are reached via apps_find/apps_run."""

from __future__ import annotations

from yomi.services.agent.app_tools import register_app_tools, search_actions
from yomi.services.agent.tools import ToolRegistry

SCHEMA = {"type": "object", "properties": {"to": {"type": "string"}}}


def _registry() -> tuple[ToolRegistry, list]:
    reg = ToolRegistry()
    calls: list = []

    async def send(**kwargs):
        calls.append(kwargs)
        return {"ok": True}

    async def search(**kwargs):
        return {"pages": []}

    reg.register("GMAIL_SEND_EMAIL", "Send an email from Gmail", SCHEMA, send, hidden=True)
    reg.register("NOTION_SEARCH_PAGES", "Search Notion pages", SCHEMA, search, hidden=True)
    reg.register("web_search", "Search the web", SCHEMA, search)
    register_app_tools(reg)
    return reg, calls


def test_app_actions_are_hidden_from_the_prompt():
    reg, _ = _registry()
    names = {t["function"]["name"] for t in reg.get_openai_tools()}
    assert names == {"web_search", "apps_find", "apps_run"}
    find = next(t for t in reg.get_openai_tools() if t["function"]["name"] == "apps_find")
    assert "gmail" in find["function"]["description"]


def test_search_ranks_by_name_and_filters_by_app():
    reg, _ = _registry()
    hits = search_actions(reg.hidden_tools(), "send email")
    assert hits[0]["action"] == "GMAIL_SEND_EMAIL" and hits[0]["parameters"] == SCHEMA
    assert [h["action"] for h in search_actions(reg.hidden_tools(), "search", "notion")] == [
        "NOTION_SEARCH_PAGES"
    ]


async def test_apps_run_executes_hidden_actions_only():
    reg, calls = _registry()
    found = await reg.execute("apps_find", query="send an email")
    assert found["matches"][0]["action"] == "GMAIL_SEND_EMAIL"
    assert await reg.execute(
        "apps_run", action="GMAIL_SEND_EMAIL", arguments={"to": "a@b.c"}
    ) == {"ok": True}
    assert calls == [{"to": "a@b.c"}]
    assert "error" in await reg.execute("apps_run", action="web_search", arguments={})
    # approval replays still reach app actions by their own name
    assert await reg.execute("GMAIL_SEND_EMAIL", to="x@y.z") == {"ok": True}


async def test_agent_sends_a_bounded_window_without_compaction(monkeypatch):
    from yomi.services.agent import loop

    sent: list[list[dict]] = []

    async def fake_completion(purpose, messages, **kwargs):
        sent.append(list(messages))
        return {"choices": [{"message": {"role": "assistant", "content": "hi"}}]}

    async def fake_prompt(*args):
        return "SYSTEM"

    monkeypatch.setattr(loop, "chat_completion", fake_completion)
    monkeypatch.setattr(loop, "_system_prompt", fake_prompt)
    history = [{"role": "user" if i % 2 else "assistant", "content": str(i)} for i in range(80)]
    assert await loop.run_agent_loop(history, "u", "explore") == "hi"
    assert len(sent) == 1  # one model call: no compaction pass
    assert sent[0][0] == {"role": "system", "content": "SYSTEM"}
    assert len(sent[0]) == 1 + loop.CONTEXT_MESSAGES and sent[0][-1]["content"] == "79"


def test_only_the_newest_screenshot_keeps_its_pixels():
    from yomi.services.agent.loop import drop_old_screenshots, format_tool_result

    messages = [
        format_tool_result("a", {"text": "first", "images": [b"\x89PNG1"]}),
        {"role": "assistant", "content": "clicking"},
        format_tool_result("b", {"text": "second", "images": [b"\x89PNG2"]}),
    ]
    drop_old_screenshots(messages)
    assert messages[0]["content"] == "first (earlier screenshot, no longer shown)"
    assert any(p["type"] == "image_url" for p in messages[2]["content"])
