"""Typed HTTP client for the computer gateway worker.

Endpoint shape mirrors the worker: ``/computer/<workspace>/<action>`` with
a Bearer deployment secret. Input actions mirror the computer-use
vocabulary (click, double_click, drag, scroll, move, type, key, wait) plus
the ``open`` helper and the ``exec`` escape hatch.
"""

from __future__ import annotations

import contextlib
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from yomi.conf import settings

_WORKSPACE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_CLICK_BUTTONS = ("left", "right", "middle")
_INPUT_ACTIONS = (
    "move", "click", "double_click", "drag", "scroll", "type", "key", "wait",
)


class ComputerError(RuntimeError):
    """Sanitized boundary error; no credentials or remote bodies."""


def _check_action(action: dict[str, Any]) -> dict[str, Any]:
    kind = action.get("action", action.get("type"))
    if kind not in _INPUT_ACTIONS:
        raise ValueError(f"Unknown computer action: {kind!r}")
    cleaned: dict[str, Any] = {"action": kind}
    if kind in ("move", "click", "double_click", "drag", "scroll"):
        for axis in ("x", "y"):
            value = action.get(axis, 0)
            if not isinstance(value, (int, float)) or not (0 <= value <= 10000):
                raise ValueError(f"Coordinate {axis} must be 0-10000")
            cleaned[axis] = int(value)
    if kind == "click":
        button = action.get("button", "left")
        if button not in _CLICK_BUTTONS:
            raise ValueError(f"Unknown mouse button: {button!r}")
        cleaned["button"] = button
    if kind == "drag" and action.get("path") is not None:
        if not isinstance(action["path"], list):
            raise ValueError("drag path must be a list of points")
        cleaned["path"] = [
            {"x": int(p.get("x", 0)), "y": int(p.get("y", 0))}
            for p in action["path"] if isinstance(p, dict)
        ]
    if kind == "scroll":
        for axis in ("dx", "dy"):
            value = action.get(axis, 0)
            if not isinstance(value, (int, float)):
                raise ValueError(f"Scroll {axis} must be numeric")
            cleaned[axis] = int(value)
    if kind == "type":
        if not isinstance(action.get("text"), str):
            raise ValueError("type requires a text string")
        cleaned["text"] = action["text"][:4000]
    if kind == "key":
        keys = action.get("keys", [action.get("key")] if action.get("key") else [])
        if not keys or not all(isinstance(k, str) for k in keys):
            raise ValueError("key requires a key name or keys list")
        cleaned["keys"] = keys
    if kind == "wait":
        seconds = action.get("seconds", 1.0)
        if not isinstance(seconds, (int, float)):
            raise ValueError("wait requires numeric seconds")
        cleaned["seconds"] = min(5.0, max(0.0, float(seconds)))
    return cleaned


class ComputerClient:
    def __init__(self, http: httpx.AsyncClient, url: str, secret: str, workspace: str):
        parsed = urlsplit(url)
        if parsed.scheme != "https" and not (
            parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
        ):
            raise ValueError("Computer gateway requires HTTPS (except localhost)")
        if (
            not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Invalid computer gateway URL")
        if len(secret) < 32:
            raise ValueError("COMPUTER_GATEWAY_SECRET must have at least 32 characters")
        if not _WORKSPACE_PATTERN.match(workspace):
            raise ValueError("Invalid workspace id")
        self.http = http
        self.url = url.rstrip("/")
        self.secret = secret
        self.workspace = workspace

    @classmethod
    def for_user(cls, http: httpx.AsyncClient, user_id: str) -> ComputerClient:
        return cls(http, settings.computer_gateway_url, settings.computer_gateway_secret, user_id)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.secret}"}

    async def _get(self, action: str) -> httpx.Response:
        try:
            response = await self.http.get(
                f"{self.url}/computer/{self.workspace}/{action}",
                headers=self._headers(), timeout=60.0, follow_redirects=False,
            )
        except httpx.HTTPError:
            raise ComputerError("Computer transport failed; outcome unknown") from None
        if response.status_code != 200:
            raise ComputerError(f"Computer request failed (HTTP {response.status_code})")
        return response

    async def _post(self, action: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self.http.post(
                f"{self.url}/computer/{self.workspace}/{action}",
                headers=self._headers(), json=payload,
                timeout=60.0, follow_redirects=False,
            )
        except httpx.HTTPError:
            raise ComputerError("Computer transport failed; outcome unknown") from None
        if response.status_code != 200:
            # Surface the desktop's reason ("element 12 is gone…") so the agent can recover.
            detail = ""
            with contextlib.suppress(ValueError, AttributeError):
                detail = str(response.json().get("error") or "")[:300]
            raise ComputerError(
                f"Computer request failed (HTTP {response.status_code})"
                + (f": {detail}" if detail else "")
            )
        try:
            data = response.json()
        except ValueError:
            raise ComputerError("Invalid computer response") from None
        if not isinstance(data, dict):
            raise ComputerError("Invalid computer response")
        return data

    async def health(self) -> dict[str, Any]:
        response = await self._get("health")
        try:
            data = response.json()
        except ValueError:
            raise ComputerError("Invalid computer response") from None
        if not isinstance(data, dict):
            raise ComputerError("Invalid computer response")
        return data

    async def screenshot(self) -> bytes:
        response = await self._get("screenshot")
        if response.headers.get("content-type") != "image/png" or not response.content:
            raise ComputerError("Invalid screenshot response")
        return response.content

    async def input(self, action: dict[str, Any]) -> dict[str, Any]:
        return await self._post("input", _check_action(dict(action)))

    async def open_url(self, url: str) -> dict[str, Any]:
        if not isinstance(url, str) or not re.match(r"^https?://", url):
            raise ValueError("only http(s) URLs may be opened")
        return await self._post("open", {"url": url})

    async def windows(self) -> dict[str, Any]:
        response = await self._get("windows")
        try:
            data = response.json()
        except ValueError:
            raise ComputerError("Invalid computer response") from None
        if not isinstance(data, dict):
            raise ComputerError("Invalid computer response")
        return data

    async def execute(self, argv: list[str]) -> dict[str, Any]:
        if not argv or not all(isinstance(a, str) for a in argv):
            raise ValueError("argv must be a non-empty list of strings")
        return await self._post("exec", {"argv": argv})

    async def browser_snapshot(self) -> dict[str, Any]:
        response = await self._get("browser-snapshot")
        try:
            data = response.json()
        except ValueError:
            raise ComputerError("Invalid computer response") from None
        if not isinstance(data, dict):
            raise ComputerError("Invalid computer response")
        return data

    async def browser_navigate(self, url: str) -> dict[str, Any]:
        if not isinstance(url, str) or not re.match(r"^https?://", url):
            raise ValueError("only http(s) URLs may be opened")
        return await self._post("browser-navigate", {"url": url})

    async def browser_act(self, action: dict[str, Any]) -> dict[str, Any]:
        return await self._post("browser-act", dict(action))
