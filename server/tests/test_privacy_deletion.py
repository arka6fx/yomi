"""Pure-logic tests for services/privacy/deletion.py (no live DB needed)."""

from __future__ import annotations

import pytest

from yomi.services.privacy.deletion import REVOCABLE_PROVIDERS, _run_step, revoke_provider_token


async def test_run_step_success_sets_done_and_count():
    step = {"name": "usage_events", "status": "pending"}

    async def work() -> int:
        return 3

    ok, count, error = await _run_step(step, work)
    assert ok is True
    assert count == 3
    assert error is None
    assert step["status"] == "done"
    assert step["deletedCount"] == 3


async def test_run_step_failure_sets_failed_and_error():
    step = {"name": "memory_entries", "status": "pending"}

    async def work() -> int:
        raise RuntimeError("boom")

    ok, count, error = await _run_step(step, work)
    assert ok is False
    assert count is None
    assert error == "boom"
    assert step["status"] == "failed"
    assert step["error"] == "boom"


@pytest.mark.parametrize(
    ("provider", "expected"),
    [
        ("google", None),  # would hit network — not exercised here
        ("slack", None),
    ],
)
async def test_revocable_providers_known(provider, expected):
    assert provider in REVOCABLE_PROVIDERS
    # Not exercising network calls; just validate membership.


async def test_non_revocable_provider_returns_false_without_network():
    # notion / api-key connectors have no revocation API — returns False
    # without making an HTTP request.
    assert await revoke_provider_token("notion", "tok") is False
    assert await revoke_provider_token("trello", "") is False


async def test_google_revoke_failure_returns_false(monkeypatch):
    import httpx

    async def fake_post(*args, **kwargs):
        return httpx.Response(400)

    monkeypatch.setattr(httpx, "post", fake_post)
    assert await revoke_provider_token("google", "bad-token") is False