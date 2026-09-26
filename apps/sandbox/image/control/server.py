"""Yomi computer control service (stdlib only, port 8081).

The agent loop talks to this over HTTP (via the sandbox gateway worker):
screenshots in, mouse/keyboard actions out. Human viewers use VNC on 5900.
"""

import json
import os
import re
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DISPLAY = os.environ.get("DISPLAY", ":99")
WIDTH = int(os.environ.get("YOMI_DESKTOP_WIDTH", "1280"))
HEIGHT = int(os.environ.get("YOMI_DESKTOP_HEIGHT", "800"))
MAX_BODY = 64 * 1024

_ENV = {"PATH": "/usr/bin:/bin:/usr/local/bin", "DISPLAY": DISPLAY}

# OpenAI computer-use key names that xdotool does not spell the same way.
_KEY_ALIASES = {
    "enter": "Return",
    "esc": "Escape",
    "del": "Delete",
    "pgup": "Page_Up",
    "pgdn": "Page_Down",
    "space": "space",
}


def _run(argv: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env=_ENV)


def _clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def _focus_window_at(x: int, y: int) -> None:
    """Activate the window under the cursor; unfocused windows swallow clicks."""
    _run(["xdotool", "mousemove", str(x), str(y)])
    result = _run(["xdotool", "getmouselocation"])
    match = re.search(r"window:(\d+)", result.stdout)
    if match and match.group(1) != "0":
        _run(["xdotool", "windowactivate", "--sync", match.group(1)])


def take_screenshot() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as tmp:
        result = _run(["scrot", "--overwrite", tmp.name])
        if result.returncode != 0:
            raise RuntimeError(f"scrot failed: {result.stderr.strip()}")
        with open(tmp.name, "rb") as handle:
            return handle.read()


def do_input(action: dict) -> dict:
    kind = str(action.get("action") or action.get("type") or "")
    x = _clamp(int(action.get("x", 0)), 0, WIDTH - 1)
    y = _clamp(int(action.get("y", 0)), 0, HEIGHT - 1)

    if kind == "move":
        _run(["xdotool", "mousemove", str(x), str(y)])
    elif kind == "click":
        button = {"left": "1", "right": "3", "middle": "2"}.get(
            str(action.get("button", "left")), "1")
        _focus_window_at(x, y)
        _run(["xdotool", "click", button])
    elif kind == "double_click":
        _focus_window_at(x, y)
        _run(["xdotool", "click", "--repeat", "2", "1"])
    elif kind == "drag":
        path = action.get("path") or []
        _focus_window_at(x, y)
        _run(["xdotool", "mousedown", "1"])
        for point in path:
            px = _clamp(int(point.get("x", x)), 0, WIDTH - 1)
            py = _clamp(int(point.get("y", y)), 0, HEIGHT - 1)
            _run(["xdotool", "mousemove", "--sync", str(px), str(py)])
        _run(["xdotool", "mouseup", "1"])
    elif kind == "scroll":
        dx, dy = int(action.get("dx", 0)), int(action.get("dy", 0))
        _focus_window_at(x, y)
        button, clicks = ("4", abs(dy) // 100) if dy < 0 else (("5", abs(dy) // 100) if dy else ("4", 0))
        for _ in range(max(1, clicks)):
            _run(["xdotool", "click", button])
        if dx:
            _run(["xdotool", "key", "Shift+Button4" if dx < 0 else "Shift+Button5"])
    elif kind == "type":
        text = str(action.get("text", ""))
        _run(["xdotool", "type", "--clearmodifiers", "--", text])
    elif kind == "key":
        keys = action.get("keys") or ([action["key"]] if action.get("key") else [])
        mapped = [_KEY_ALIASES.get(str(k).lower(), str(k)) for k in keys]
        _run(["xdotool", "key", "--clearmodifiers", "+".join(mapped)])
    elif kind == "wait":
        import time

        time.sleep(min(5.0, float(action.get("seconds", 1.0))))
    else:
        raise ValueError(f"unknown input action: {kind!r}")
    return {"ok": True, "action": kind}


def open_url(url: str) -> dict:
    if not re.match(r"^https?://", url):
        raise ValueError("only http(s) URLs may be opened")
    # Drive the running Chrome over DevTools. A bare `google-chrome URL` starts a
    # second browser with the default profile, which fails silently as root.
    from browser_driver import driver

    page = driver().navigate(url)
    return {"ok": True, "url": page["url"], "title": page["title"]}


def list_windows() -> dict:
    result = _run(["wmctrl", "-l"])
    windows = []
    for line in result.stdout.splitlines():
        parts = line.split(None, 3)
        if len(parts) == 4:
            windows.append({"id": parts[0], "title": parts[3]})
    return {"windows": windows}


class Handler(BaseHTTPRequestHandler):
    server_version = "YomiComputer/1"

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("missing or oversized body")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:  # noqa: N802
        try:
            if self.path == "/health":
                self._send_json(200, {"ok": True, "display": f"{WIDTH}x{HEIGHT}"})
            elif self.path == "/screenshot" or self.path.startswith("/screenshot?"):
                import base64
                from urllib.parse import urlparse, parse_qs

                shot = take_screenshot()
                if parse_qs(urlparse(self.path).query).get("format") == ["base64"]:
                    self._send_json(200, {"png": base64.b64encode(shot).decode()})
                    return
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(shot)))
                self.end_headers()
                self.wfile.write(shot)
            elif self.path == "/windows":
                self._send_json(200, list_windows())
            elif self.path == "/browser/snapshot":
                from browser_driver import driver

                self._send_json(200, driver().snapshot())
            else:
                self._send_json(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001 — control plane must stay up
            self._send_json(500, {"error": f"{type(exc).__name__}: {exc}"})

    def do_POST(self) -> None:  # noqa: N802
        try:
            if self.path == "/input":
                self._send_json(200, do_input(self._read_json()))
            elif self.path == "/open":
                self._send_json(200, open_url(str(self._read_json().get("url", ""))))
            elif self.path == "/browser/navigate":
                from browser_driver import driver

                url = str(self._read_json().get("url", ""))
                if not re.match(r"^https?://", url):
                    raise ValueError("only http(s) URLs may be opened")
                self._send_json(200, driver().navigate(url))
            elif self.path == "/browser/act":
                from browser_driver import driver

                self._send_json(200, driver().act(self._read_json()))
            else:
                self._send_json(404, {"error": "not found"})
        except Exception as exc:  # noqa: BLE001
            self._send_json(400 if isinstance(exc, ValueError) else 500,
                            {"error": f"{type(exc).__name__}: {exc}"})

    def log_message(self, *args: object) -> None:
        pass


def main() -> None:
    # 0.0.0.0: reachable both from inside the sandbox (exec curl) and via
    # published ports when running the image locally.
    server = ThreadingHTTPServer(("0.0.0.0", 8081), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
