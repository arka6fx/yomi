"""Pictures of a character from an existing work, for the maker's "what do they look like?".

The same free sources as the lookup: AniList and TVMaze give one portrait each, and the
character's page on the series' Fandom wiki (a MediaWiki) lists many more images, which
page through with "more pictures". Only the search text leaves Yomi, and every source is
best effort: a slow or missing wiki just contributes nothing.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Any

import httpx

from yomi.logging import get_logger
from yomi.services.character_lookup import lookup, name_score, split_query
from yomi.services.http_pool import shared_client

logger = get_logger(__name__)

MIN_SIDE = 200
_TIMEOUT = httpx.Timeout(8.0, connect=4.0)
_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}
# Wiki furniture that isn't a picture of anyone.
_JUNK = re.compile(
    r"icon|logo|symbol|flag|favicon|button|placeholder|signature|kanji|banner|stub|"
    r"arrow|wordmark|site-|wiki|emblem|badge|map",
    re.I,
)


def wiki_candidates(work: str) -> list[str]:
    """Likely Fandom subdomains for a series: 'Jujutsu Kaisen' -> jujutsu-kaisen, jujutsukaisen."""
    words = re.sub(r"[^a-z0-9 ]", "", work.lower()).split()
    if words and words[0] == "the" and len(words) > 1:
        words = words[1:]
    if not words:
        return []
    out = ["-".join(words), "".join(words)]
    return list(dict.fromkeys(w for w in out if w))[:2]


def scaled(url: str, width: int = 400) -> str:
    """Fandom serves originals; ask its image CDN for a phone-sized copy instead."""
    return re.sub(
        r"/revision/latest(?=[?/]|$)",
        f"/revision/latest/scale-to-width-down/{width}",
        url,
        count=1,
    )


def _encode(state: dict[str, str]) -> str:
    return base64.urlsafe_b64encode(json.dumps(state).encode()).decode()


def _decode(cursor: str) -> dict[str, str] | None:
    try:
        state = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except (ValueError, binascii.Error, json.JSONDecodeError):
        return None
    if not isinstance(state, dict) or not all(isinstance(v, str) for v in state.values()):
        return None
    if not {"wiki", "title", "from"} <= state.keys():
        return None
    # The cursor comes back from the browser: keep it to a plain Fandom subdomain.
    if not re.fullmatch(r"[a-z0-9-]{1,60}", state["wiki"]):
        return None
    return state


async def _wiki_get(wiki: str, params: dict[str, Any]) -> dict[str, Any]:
    response = await shared_client().get(
        f"https://{wiki}.fandom.com/api.php",
        params={"action": "query", "format": "json", "formatversion": "2", **params},
        timeout=_TIMEOUT,
    )
    response.raise_for_status()
    return response.json()


async def _find_title(wiki: str, name: str) -> str | None:
    """The wiki page for this character: the exact title if it exists, else the top search hit."""
    data = await _wiki_get(wiki, {"titles": name, "redirects": "1"})
    pages = (data.get("query") or {}).get("pages") or []
    if pages and not pages[0].get("missing") and not pages[0].get("invalid"):
        return str(pages[0].get("title") or name)
    data = await _wiki_get(wiki, {"list": "search", "srsearch": name, "srlimit": "1"})
    hits = (data.get("query") or {}).get("search") or []
    if hits and name_score(name, str(hits[0].get("title") or "")):
        return str(hits[0]["title"])
    return None


async def _page_images(wiki: str, title: str, start: str = "") -> tuple[list[dict], str | None]:
    """One batch of real pictures from a wiki page, and where the next batch starts."""
    params = {
        "titles": title,
        "redirects": "1",
        "generator": "images",
        "gimlimit": "50",
        "prop": "imageinfo",
        "iiprop": "url|size|mime",
    }
    if start:
        params["gimcontinue"] = start
    data = await _wiki_get(wiki, params)
    pictures = []
    for page in (data.get("query") or {}).get("pages") or []:
        info = (page.get("imageinfo") or [{}])[0]
        name = str(page.get("title") or "")
        if (
            info.get("mime") in _IMAGE_TYPES
            and min(int(info.get("width") or 0), int(info.get("height") or 0)) >= MIN_SIDE
            and not _JUNK.search(name)
            and str(info.get("url") or "").startswith("https://")
        ):
            pictures.append({"url": scaled(info["url"]), "credit": "Fandom", "source": "fandom"})
    return pictures, (data.get("continue") or {}).get("gimcontinue")


async def _fandom_first(name: str, work: str) -> tuple[list[dict], str | None]:
    for wiki in wiki_candidates(work):
        try:
            title = await _find_title(wiki, name)
            if not title:
                continue
            pictures, start = await _page_images(wiki, title)
        except Exception as exc:  # a wiki that doesn't exist or times out
            logger.info("fandom %s: %s", wiki, type(exc).__name__)
            continue
        if pictures:
            nxt = _encode({"wiki": wiki, "title": title, "from": start}) if start else None
            return pictures, nxt
    return [], None


async def pictures(query: str, cursor: str = "") -> dict[str, Any]:
    """{"pictures": [{url, credit, source}], "next": cursor or None} for a based-on text."""
    query = query.strip()[:120]
    if cursor:
        state = _decode(cursor)
        if state is None:
            return {"pictures": [], "next": None}
        try:
            found, start = await _page_images(state["wiki"], state["title"], state["from"])
        except Exception as exc:
            logger.info("fandom more %s: %s", state["wiki"], type(exc).__name__)
            return {"pictures": [], "next": None}
        nxt = _encode({**state, "from": start}) if start else None
        return {"pictures": found, "next": nxt}

    if len(query) < 2:
        return {"pictures": [], "next": None}
    name, work = split_query(query)
    portraits: list[dict] = []
    try:
        for result in await lookup(query):
            # lookup also returns other characters from the same search; keep this one.
            if result.get("imageUrl") and name_score(name or query, result.get("name", "")):
                portraits.append({
                    "url": result["imageUrl"],
                    "credit": result.get("imageCredit") or "",
                    "source": result.get("source") or "",
                })
            if not work and result.get("work"):
                work = str(result["work"])
    except Exception as exc:
        logger.info("picture lookup failed: %s", type(exc).__name__)
    fandom, nxt = await _fandom_first(name or query, work) if work else ([], None)
    seen: set[str] = set()
    out = []
    for picture in portraits[:2] + fandom:
        if picture["url"] not in seen:
            seen.add(picture["url"])
            out.append(picture)
    # Whole batches only: the cursor resumes after everything this page fetched.
    return {"pictures": out, "next": nxt}
