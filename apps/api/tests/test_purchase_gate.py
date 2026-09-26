"""Buttons that spend money wait for the user's Approve, whatever the model decides."""

from __future__ import annotations

import pytest

from yomi.services.agent.tools import ToolRegistry, is_commit_button, register_computer_tools

CART = "https://www.amazon.in/gp/cart"


def test_purchase_buttons_are_recognised():
    for name in ("Place your order", "Pay ₹1,299", "Proceed to Pay", "Buy Now",
                 "Confirm booking", "Book ride", "Request Uber", "Confirm and pay"):
        assert is_commit_button(name), name
    for name in ("Add to Cart", "Proceed to checkout", "Search", "Payment methods help",
                 "Apply coupon", ""):
        assert not is_commit_button(name), name


@pytest.fixture
def desktop(monkeypatch):
    """A fake desktop: a checkout page whose element numbers can change."""
    monkeypatch.setattr("yomi.conf.settings.computer_gateway_url", "https://computer.test")
    monkeypatch.setattr("yomi.conf.settings.computer_gateway_secret", "s" * 40)
    state = {
        "url": CART,
        "elements": [{"ref": "3", "role": "button", "name": "Add to Cart"},
                     {"ref": "7", "role": "button", "name": "Place your order"}],
        "clicked": [],
    }

    def page():
        return {"url": state["url"], "title": "Checkout", "elements": state["elements"],
                "text": "", "tabs": 1}

    async def snapshot(self):
        return page()

    async def act(self, action):
        name = next(e["name"] for e in state["elements"] if e["ref"] == action["ref"])
        state["clicked"].append(name)
        return page()

    monkeypatch.setattr("yomi.services.computer.client.ComputerClient.browser_snapshot", snapshot)
    monkeypatch.setattr("yomi.services.computer.client.ComputerClient.browser_act", act)
    return state


async def test_place_order_waits_for_approval(desktop):
    pending: list[dict] = []

    async def create_pending_action(meta):
        pending.append(meta)
        return {"status": "pending_approval"}

    reg = ToolRegistry()
    register_computer_tools(reg, "u1", create_pending_action)
    await reg.execute("web_page")

    await reg.execute("web_act", action="click", ref="3")
    assert desktop["clicked"] == ["Add to Cart"]  # ordinary clicks just happen

    assert await reg.execute("web_act", action="click", ref="7") == {"status": "pending_approval"}
    assert desktop["clicked"] == ["Add to Cart"]  # the order was NOT placed
    meta = pending[0]
    assert meta["risk"] == "payment" and "Place your order" in meta["title"]
    assert meta["payload"]["expect_name"] == "Place your order"
    assert meta["payload"]["expect_url"] == CART


async def test_approved_click_finds_the_button_again(desktop):
    reg = ToolRegistry()
    register_computer_tools(reg, "u1")  # approval replays run without the gate
    desktop["elements"] = [{"ref": "12", "role": "button", "name": "Place your order"}]
    payload = {"action": "click", "ref": "7", "expect_name": "Place your order",
               "expect_url": CART}
    await reg.execute("web_act", **payload)
    assert desktop["clicked"] == ["Place your order"]


async def test_approved_click_refuses_if_the_page_moved_on(desktop):
    reg = ToolRegistry()
    register_computer_tools(reg, "u1")
    desktop["url"] = "https://www.amazon.in/"
    result = await reg.execute(
        "web_act", action="click", ref="7", expect_name="Place your order", expect_url=CART
    )
    assert "page changed" in result and desktop["clicked"] == []
