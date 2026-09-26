"""Start and stop the desktop's Chrome around saved logins.

The profile lives in /home/yomi/chrome-profile so the gateway can snapshot it to
R2 before the desktop sleeps and restore it on the next wake. Chrome must be
closed cleanly before a snapshot (it flushes cookies on exit) and must not start
until a restore has finished, so it's started on demand instead of at boot.
"""

from __future__ import annotations

import os
import signal
import subprocess
import time
import urllib.request

PROFILE_DIR = "/home/yomi/chrome-profile"
CDP_VERSION_URL = "http://127.0.0.1:9222/json/version"
WIDTH = os.environ.get("YOMI_DESKTOP_WIDTH", "1280")
HEIGHT = os.environ.get("YOMI_DESKTOP_HEIGHT", "800")
_ENV = {
    "PATH": "/usr/bin:/bin:/usr/local/bin",
    "DISPLAY": os.environ.get("DISPLAY", ":99"),
    "HOME": "/home/yomi",
}
_process: subprocess.Popen | None = None
_fresh_launch = False


def take_fresh_launch() -> bool:
    """True once after each launch, so saved cookies are loaded exactly once."""
    global _fresh_launch
    fresh, _fresh_launch = _fresh_launch, False
    return fresh


def running() -> bool:
    try:
        with urllib.request.urlopen(CDP_VERSION_URL, timeout=1.5) as response:
            return response.status == 200
    except Exception:  # noqa: BLE001 — any failure means "not reachable"
        return False


def start(timeout: float = 20.0) -> bool:
    """Launch Chrome on the visible display if it isn't already up."""
    global _process, _fresh_launch
    if running():
        return True
    os.makedirs(PROFILE_DIR, exist_ok=True)
    # A profile restored from another boot still carries the old instance's locks.
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        path = os.path.join(PROFILE_DIR, name)
        if os.path.lexists(path):
            os.remove(path)
    _process = subprocess.Popen(
        [
            "google-chrome", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu",
            "--no-first-run", "--no-default-browser-check", "--test-type",
            "--password-store=basic",
            "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222",
            f"--user-data-dir={PROFILE_DIR}", f"--window-size={WIDTH},{HEIGHT}",
            "--window-position=0,0", "--start-maximized", "about:blank",
        ],
        env=_ENV,
        stdout=open("/tmp/chrome.log", "ab"),  # noqa: SIM115 — lives as long as Chrome
        stderr=subprocess.STDOUT,
    )
    _fresh_launch = True
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if running():
            return True
        time.sleep(0.3)
    return False


def stop(timeout: float = 10.0) -> None:
    """Wait for Chrome to finish quitting (the driver asks it to close cleanly
    first); only processes still alive after the timeout are forced to stop."""
    global _process
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        busy = subprocess.run(["pgrep", "-f", "chrome/chrome"], capture_output=True, check=False)
        if busy.returncode != 0:
            break
        time.sleep(0.3)
    else:
        subprocess.run(["pkill", "-TERM", "-f", "chrome/chrome"], check=False)
        time.sleep(2)
        subprocess.run(["pkill", "-KILL", "-f", "chrome/chrome"], check=False)
    if _process is not None:
        try:
            _process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            os.kill(_process.pid, signal.SIGKILL)
        _process = None
