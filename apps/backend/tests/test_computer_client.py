"""Unit tests for the computer gateway client (mock transport)."""

from __future__ import annotations

import httpx
import pytest

from yomi.services.computer.client import ComputerClient, ComputerError


def client(handler, workspace: str = "u-1") -> ComputerClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return ComputerClient(http, "https://computer.example.test", "s" * 32, workspace)


def test_rejects_bad_url_secret_workspace() -> None:
    http = httpx.AsyncClient()
    with pytest.raises(ValueError, match="HTTPS"):
        ComputerClient(http, "http://remote.example.test", "s" * 32, "u-1")
    with pytest.raises(ValueError, match="32 characters"):
        ComputerClient(http, "https://computer.example.test", "short", "u-1")
    with pytest.raises(ValueError, match="workspace"):
        ComputerClient(http, "https://computer.example.test", "s" * 32, "../x")


class TestActions:
    @pytest.mark.asyncio
    async def test_screenshot_returns_png_bytes(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == "/computer/u-1/screenshot"
            assert request.headers["Authorization"] == f"Bearer {'s' * 32}"
            return httpx.Response(200, content=b"\x89PNG...", headers={"content-type": "image/png"})

        storage = client(handler)
        try:
            assert await storage.screenshot() == b"\x89PNG..."
        finally:
            await storage.http.aclose()

    @pytest.mark.asyncio
    async def test_input_validates_before_sending(self) -> None:
        async def handler(_request: httpx.Request) -> httpx.Response:
            raise AssertionError("must not send invalid actions")

        storage = client(handler)
        try:
            with pytest.raises(ValueError, match="Unknown computer action"):
                await storage.input({"action": "rm -rf"})
            with pytest.raises(ValueError, match="Coordinate"):
                await storage.input({"action": "click", "x": -5, "y": 10})
            with pytest.raises(ValueError, match="text string"):
                await storage.input({"action": "type"})
        finally:
            await storage.http.aclose()

    @pytest.mark.asyncio
    async def test_input_normalizes_and_posts(self) -> None:
        seen: dict = {}

        async def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen.update(json.loads(request.content))
            return httpx.Response(200, json={"ok": True, "action": "click"})

        storage = client(handler)
        try:
            res = await storage.input({"action": "click", "x": 10, "y": 20, "junk": 1})
            assert res == {"ok": True, "action": "click"}
            assert seen == {"action": "click", "x": 10, "y": 20, "button": "left"}
        finally:
            await storage.http.aclose()

    @pytest.mark.asyncio
    async def test_open_rejects_non_http(self) -> None:
        storage = client(lambda _r: httpx.Response(200, json={}))
        try:
            with pytest.raises(ValueError, match="http"):
                await storage.open_url("file:///etc/passwd")
        finally:
            await storage.http.aclose()

    @pytest.mark.asyncio
    async def test_transport_failure_is_sanitized(self) -> None:
        async def handler(_request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("secret dial detail")

        storage = client(handler)
        try:
            with pytest.raises(ComputerError, match="transport failed") as raised:
                await storage.health()
            assert "secret dial detail" not in str(raised.value)
        finally:
            await storage.http.aclose()

    @pytest.mark.asyncio
    async def test_exec_validates_argv(self) -> None:
        storage = client(lambda _r: httpx.Response(200, json={}))
        try:
            with pytest.raises(ValueError, match="argv"):
                await storage.execute([])
            with pytest.raises(ValueError, match="argv"):
                await storage.execute(["ls", 42])
        finally:
            await storage.http.aclose()
