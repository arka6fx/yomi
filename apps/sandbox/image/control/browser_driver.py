"""Drive the desktop's Chrome through DevTools, the way a person reads a page.

Instead of guessing pixel coordinates from screenshots, the agent gets each page
as text plus a numbered list of the things it can click or fill in, then acts on
those numbers. Chrome keeps running on the visible desktop, so a human watching
(or taking over for a login or OTP) sees exactly what the agent does.

Playwright's sync API is single-threaded, so every call runs on one worker
thread; HTTP handler threads just submit jobs and wait.
"""

from __future__ import annotations

import queue
import threading
import time
from collections.abc import Callable
from typing import Any

CDP_URL = "http://127.0.0.1:9222"
MAX_ELEMENTS = 160
MAX_TEXT = 4000
SETTLE_S = 0.8

# Marks every visible interactive element with data-yomi-ref and describes it.
_SNAPSHOT_JS = r"""
(max) => {
  document.querySelectorAll('[data-yomi-ref]').forEach(e => e.removeAttribute('data-yomi-ref'));
  const sel = 'a[href], button, input, select, textarea, summary, [role=button], [role=link],' +
    '[role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=combobox],' +
    '[role=switch], [contenteditable=""], [contenteditable=true], [onclick], [tabindex]:not([tabindex="-1"])';
  const seen = new Set();
  const dupes = new Set();
  const out = [];
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // What a person sees: this screen plus a little below. Scroll for more.
    if (r.bottom < -20 || r.top > innerHeight * 1.6) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const label = (el) => {
    const pick = (v) => (v || '').replace(/\s+/g, ' ').trim();
    let text = pick(el.getAttribute('aria-label')) || pick(el.innerText) || pick(el.value) ||
      pick(el.getAttribute('placeholder')) || pick(el.getAttribute('title')) ||
      pick(el.getAttribute('alt')) || pick(el.getAttribute('name'));
    if (!text && el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) text = pick(l.innerText);
    }
    if (!text) { const img = el.querySelector('img[alt]'); if (img) text = pick(img.alt); }
    return text.slice(0, 90);
  };
  for (const el of document.querySelectorAll(sel)) {
    if (out.length >= max) break;
    if (seen.has(el) || !visible(el)) continue;
    if (el.closest('[data-yomi-ref]') && el.tagName !== 'INPUT') continue;
    seen.add(el);
    // An image link and a title link to the same product are one thing to a person.
    const href = el.tagName === 'A' ? el.getAttribute('href') : null;
    const name0 = label(el);
    if (href) {
      if (dupes.has(href)) continue;
      dupes.add(href);
    }
    const ref = String(out.length + 1);
    el.setAttribute('data-yomi-ref', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'input' ? (el.type || 'text') : tag);
    const item = { ref, role, name: name0 };
    if (tag === 'input' || tag === 'textarea') item.value = String(el.value || '').slice(0, 60);
    if (el.type === 'checkbox' || el.type === 'radio') item.checked = el.checked;
    if (el.disabled) item.disabled = true;
    if (tag === 'select') item.options = [...el.options].slice(0, 12).map(o => o.text.trim());
    out.push(item);
  }
  // Main content first: menus and footers are noise for reading a page.
  const main = document.querySelector('main, [role=main], #search, #content, #main') || document.body;
  const text = (main ? main.innerText : '').replace(/\n{3,}/g, '\n\n');
  return { elements: out, text };
}
"""


class BrowserDriver:
    def __init__(self) -> None:
        self._jobs: queue.Queue[tuple[Callable[[], Any], queue.Queue]] = queue.Queue()
        self._pw = None
        self._browser = None
        self._page = None
        threading.Thread(target=self._loop, daemon=True).start()

    # -- worker thread -------------------------------------------------------
    def _loop(self) -> None:
        while True:
            job, reply = self._jobs.get()
            try:
                reply.put((True, job()))
            except Exception as exc:  # noqa: BLE001 — reported to the caller
                reply.put((False, exc))

    def _call(self, fn: Callable[[], Any], timeout: float = 60.0) -> Any:
        reply: queue.Queue = queue.Queue(maxsize=1)
        self._jobs.put((fn, reply))
        ok, value = reply.get(timeout=timeout)
        if not ok:
            raise value
        return value

    def _connect(self):
        from playwright.sync_api import sync_playwright

        import chrome

        if self._browser is not None and self._browser.is_connected():
            return self._browser
        if self._pw is None:
            self._pw = sync_playwright().start()
        chrome.start()
        last: Exception | None = None
        for _ in range(20):  # Chrome may still be starting after a boot
            try:
                self._browser = self._pw.chromium.connect_over_cdp(CDP_URL)
                return self._browser
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(0.5)
        raise RuntimeError(f"Chrome DevTools unreachable: {last}")

    def _current(self):
        browser = self._connect()
        context = browser.contexts[0] if browser.contexts else browser.new_context()
        pages = [p for p in context.pages if not p.is_closed()]
        if self._page is None or self._page.is_closed() or self._page not in pages:
            self._page = pages[-1] if pages else context.new_page()
        # Follow a tab the page just opened (e.g. "open in new tab" product links).
        if pages and pages[-1] is not self._page and pages[-1].url not in ("about:blank", ""):
            self._page = pages[-1]
        self._page.bring_to_front()
        return self._page

    def _settle(self, page) -> None:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=8000)
        except Exception:  # noqa: BLE001 — slow pages still get a snapshot
            pass
        time.sleep(SETTLE_S)

    def _snapshot(self, page) -> dict[str, Any]:
        data = page.evaluate(_SNAPSHOT_JS, MAX_ELEMENTS)
        text = data.get("text") or ""
        return {
            "url": page.url,
            "title": page.title(),
            "elements": data.get("elements") or [],
            "text": text[:MAX_TEXT] + ("…" if len(text) > MAX_TEXT else ""),
            "tabs": len([p for p in page.context.pages if not p.is_closed()]),
        }

    def _locator(self, page, ref: str):
        locator = page.locator(f'[data-yomi-ref="{ref}"]').first
        if locator.count() == 0:
            raise ValueError(f"element {ref} is gone; take a fresh snapshot")
        return locator

    # -- public API (called from HTTP threads) --------------------------------
    def close_chrome(self) -> None:
        """Quit Chrome the way its own menu does, so cookies and local storage are
        written to disk. A SIGTERM skips that and loses fresh logins."""
        import chrome

        def job():
            if chrome.running():
                try:
                    browser = self._connect()
                    session = browser.new_browser_cdp_session()
                    session.send("Browser.close")
                except Exception:  # noqa: BLE001 — chrome.stop() still ends it
                    pass
            self._browser = None
            self._page = None

        self._call(job, timeout=20)

    def snapshot(self) -> dict[str, Any]:
        return self._call(lambda: self._snapshot(self._current()))

    def navigate(self, url: str) -> dict[str, Any]:
        def job():
            page = self._current()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            self._settle(page)
            return self._snapshot(page)

        return self._call(job)

    def act(self, action: dict[str, Any]) -> dict[str, Any]:
        kind = str(action.get("action") or "")
        ref = str(action.get("ref") or "")

        def job():
            page = self._current()
            if kind == "click":
                self._locator(page, ref).click(timeout=10000)
            elif kind == "type":
                target = self._locator(page, ref)
                target.click(timeout=10000)
                target.fill(str(action.get("text", "")), timeout=10000)
                if action.get("submit"):
                    target.press("Enter")
            elif kind == "select":
                self._locator(page, ref).select_option(label=str(action.get("value", "")))
            elif kind == "check":
                self._locator(page, ref).set_checked(bool(action.get("checked", True)))
            elif kind == "press":
                page.keyboard.press(str(action.get("key") or "Enter"))
            elif kind == "scroll":
                amount = 700 if str(action.get("direction", "down")) == "down" else -700
                page.mouse.wheel(0, amount)
            elif kind == "back":
                page.go_back(wait_until="domcontentloaded", timeout=15000)
            elif kind == "wait":
                time.sleep(min(10.0, float(action.get("seconds", 2))))
            else:
                raise ValueError(f"unknown browser action: {kind!r}")
            self._settle(page)
            return self._snapshot(self._current())

        return self._call(job)


_driver: BrowserDriver | None = None
_lock = threading.Lock()


def driver() -> BrowserDriver:
    global _driver
    with _lock:
        if _driver is None:
            _driver = BrowserDriver()
        return _driver
