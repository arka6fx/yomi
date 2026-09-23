"""Keyless, dependency-free web tools for the agent (no Cloudflare products).

The previous implementation called Cloudflare's *Browser Rendering* REST
endpoints (``/browser/scrape``, ``/browser/screenshot``, ``/browser/extract``,
``/browser/crawl``). Browser Rendering isn't provisioned on this account
(paths 404 AND the ``browser-rendering/content`` product endpoint returns 401
"Authentication error"), so those calls failed with 400/404/401. The agent's
``web_search`` also delegated to a deprecated ``llama-3.1-8b`` Workers AI
model (now 410 Gone), which was never a real web search.

These tools need no API key and no extra Cloudflare product: ``scrape`` /
``extract`` / ``crawl`` fetch the page over plain HTTPS and reduce the HTML
to readable text with the stdlib ``html.parser``; ``search_results`` queries
DuckDuckGo's HTML endpoint (no key). ``screenshot`` genuinely needs a
headless browser — it raises a clear error instead of trying a defunct route.
"""

from __future__ import annotations

import re
import urllib.parse
from html.parser import HTMLParser
from typing import Any

import httpx

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_TIMEOUT = httpx.Timeout(25.0)
_MAX_TEXT_CHARS = 12_000
_BLOCK_TAGS = {
    "p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "section",
    "article", "blockquote", "pre", "ul", "ol",
}
_IGNORED_TAGS = {"script", "style", "noscript", "svg", "iframe", "template", "head"}
_DDG_URL = "https://html.duckduckgo.com/html/"
_MAX_RESULTS = 8


def _headers() -> dict[str, str]:
    return {"User-Agent": _UA, "Accept": "text/html,application/xhtml+xml,*/*;q=0.9"}


async def _fetch(url: str) -> str:
    if not isinstance(url, str) or not url.lower().startswith(("https://", "http://")):
        raise ValueError("url must be an absolute http(s) URL")
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True, headers=_headers()) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.text


class _MarkdownParser(HTMLParser):
    """Reduce an HTML document to readable (markdown-ish) text + links."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._parts: list[str] = []
        self._skip = 0
        self._links: list[tuple[str, str]] = []
        self._in_link = False
        self._link_buf: list[str] = []
        self._href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        low = tag.lower()
        if low in _IGNORED_TAGS:
            self._skip += 1
        if low in _BLOCK_TAGS:
            self._parts.append("\n")
        if low == "a":
            self._in_link = True
            self._link_buf = []
            self._href = next((v or "" for k, v in attrs if k == "href"), "")

    def handle_endtag(self, tag: str) -> None:
        low = tag.lower()
        if low in _IGNORED_TAGS:
            self._skip = max(0, self._skip - 1)
        if low == "a":
            self._in_link = False
            label = "".join(self._link_buf).strip()
            label = re.sub(r"\s+", " ", label)
            if label and self._href.startswith("http"):
                self._links.append((label, self._href))
                self._parts.append(f"[{label}]({self._href})")
            elif label:
                self._parts.append(label)
        elif low in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        self._parts.append(data)
        if self._in_link:
            self._link_buf.append(data)

    def text(self) -> str:
        raw = "".join(self._parts)
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        lines = [ln.strip() for ln in raw.splitlines()]
        out = "\n".join(ln for ln in lines if ln)
        if self._links:
            out += "\n\nLinks:\n" + "\n".join(
                f"- [{label}]({href})" for label, href in self._links[:15]
            )
        if len(out) > _MAX_TEXT_CHARS:
            out = out[:_MAX_TEXT_CHARS] + "\n…(truncated)"
        return out


async def scrape(url: str) -> str:
    """Fetch a webpage and return its readable text."""
    parser = _MarkdownParser()
    parser.feed(await _fetch(url))
    parser.close()
    return parser.text()


async def extract(url: str, prompt: str) -> str:
    """Fetch a webpage; ``prompt`` steers the agent toward what to find."""
    parser = _MarkdownParser()
    parser.feed(await _fetch(url))
    parser.close()
    body = parser.text()
    if prompt:
        return f"Looking for: {prompt}\n\n---\n{body}\n---\n\n(Answer using only the page above.)"
    return body


async def screenshot(url: str) -> bytes:
    """Screenshots need a real headless browser (Cloudflare Browser Rendering).

    That product isn't enabled on this account, so there is no route that can
    produce one. Raised so the agent surfaces a clear explanation instead of a
    confusing API error.
    """
    raise RuntimeError(
        "Screenshots require Cloudflare Browser Rendering, which isn't enabled "
        f"on this account. Use scrape or extract on {url!r} to read the page instead."
    )


async def crawl(url: str, max_pages: int = 5) -> list[dict[str, Any]]:
    """Fetch a single page (no multi-page crawl without a browser product)."""
    text = await scrape(url)
    return [{"url": url, "markdown": text}]


class _DDGResults(HTMLParser):
    """Extract (title, href, snippet) triples from DuckDuckGo's HTML results."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[tuple[str, str, str]] = []
        self.pending_title = ""
        self._mode: str | None = None  # "title" | "snippet"
        self._buf: list[str] = []
        self._href = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        classes = set((dict(attrs).get("class") or "").split())
        if tag == "a" and "result__a" in classes:
            self._mode = "title"
            self._buf = []
            self._href = dict(attrs).get("href", "") or ""
        elif tag == "a" and "result__snippet" in classes and self.pending_title:
            self._mode = "snippet"
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._mode:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._mode == "title":
            self.pending_title = " ".join("".join(self._buf).split())
            self._mode = None
            if self._href:
                self.results.append((self.pending_title, self._decode_ddg(self._href), ""))
        elif tag == "a" and self._mode == "snippet" and self.results:
            title, href, _ = self.results[-1]
            snippet = " ".join("".join(self._buf).split())
            self.results[-1] = (title, href, snippet)
            self.pending_title = ""
            self._mode = None

    @staticmethod
    def _decode_ddg(href: str) -> str:
        """DuckDuckGo wraps real URLs in a /l/?uddg= redirect; unwrap it."""
        if href.startswith("//"):
            href = "https:" + href
        qs = urllib.parse.parse_qs(urllib.parse.urlsplit(href).query)
        target = (qs.get("uddg") or [""])[0]
        if target:
            return target
        return href


async def search_results(query: str) -> str:
    """Keyless DuckDuckGo web search; returns markdown summary of results."""
    if not isinstance(query, str) or not query.strip():
        return "Please provide a non-empty search query."
    search_url = _DDG_URL + "?" + urllib.parse.urlencode({"q": query.strip()})
    try:
        page = await _fetch(search_url)
    except httpx.HTTPError as exc:
        return f"Web search unavailable right now ({exc.__class__.__name__}). Try again shortly."
    parser = _DDGResults()
    parser.feed(page)
    parser.close()
    results = parser.results[:_MAX_RESULTS]
    if not results:
        return "No web results found."
    lines: list[str] = []
    for i, (title, href, snippet) in enumerate(results, 1):
        lines.append(f"{i}. [{title}]({href})")
        if snippet:
            lines.append(f"   {snippet}")
    return "\n".join(lines)
