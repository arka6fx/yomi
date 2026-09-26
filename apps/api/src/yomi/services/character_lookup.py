"""Look up a character from an existing work, to prefill "based on" in the maker.

Two free, keyless public sources: AniList (anime and manga characters, GraphQL)
and TVMaze (TV show casts, REST). Only the search text leaves Yomi; both are
best-effort, so a slow or failing source just contributes no results.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import httpx

from yomi.logging import get_logger
from yomi.services.http_pool import shared_client

logger = get_logger(__name__)

ANILIST_URL = "https://graphql.anilist.co"
TVMAZE_URL = "https://api.tvmaze.com"
MAX_RESULTS = 8
_TIMEOUT = httpx.Timeout(8.0, connect=4.0)

_ANILIST_QUERY = """
query ($q: String) {
  Page(perPage: 5) {
    characters(search: $q, sort: FAVOURITES_DESC) {
      name { full }
      image { large }
      description(asHtml: false)
      siteUrl
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { english romaji } } }
    }
  }
}
"""


def _plain(text: str | None, limit: int = 500) -> str:
    """AniList descriptions carry markdown, spoiler tags and HTML; keep plain prose."""
    text = re.sub(r"~!.*?!~", "", text or "", flags=re.S)  # spoilers
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"__(.+?)__|\*\*(.+?)\*\*", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"\[(.+?)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(" ", 1)[0] + "…"


def _based_on(name: str, work: str) -> str:
    return f"{name} ({work})"[:120] if work else name[:120]


def split_query(query: str) -> tuple[str, str]:
    """'Gojo (Jujutsu Kaisen)' -> ('Gojo', 'Jujutsu Kaisen'); plain text has no work."""
    match = re.match(r"^\s*(.*?)\s*\((.+)\)\s*$", query)
    return (match.group(1), match.group(2)) if match else (query.strip(), "")


async def search_anilist(query: str) -> list[dict[str, Any]]:
    name, _ = split_query(query)
    response = await shared_client().post(
        ANILIST_URL,
        json={"query": _ANILIST_QUERY, "variables": {"q": name or query}},
        timeout=_TIMEOUT,
    )
    response.raise_for_status()
    characters = (((response.json().get("data") or {}).get("Page") or {}).get("characters")) or []
    results = []
    for c in characters:
        full = ((c.get("name") or {}).get("full") or "").strip()
        if not full:
            continue
        nodes = (c.get("media") or {}).get("nodes") or []
        title = (nodes[0].get("title") or {}) if nodes else {}
        work = title.get("english") or title.get("romaji") or ""
        results.append({
            "name": full,
            "work": work,
            "basedOn": _based_on(full, work),
            "description": _plain(c.get("description")),
            "imageUrl": (c.get("image") or {}).get("large") or "",
            "imageCredit": "AniList",
            "url": c.get("siteUrl") or "",
            "source": "anilist",
        })
    return results


async def search_tvmaze(query: str) -> list[dict[str, Any]]:
    """TVMaze has no character search, so find the show and read its cast.

    'Walter White (Breaking Bad)' filters Breaking Bad's cast by name; a bare
    show title returns its main characters.
    """
    name, work = split_query(query)
    client = shared_client()
    shows = await client.get(
        f"{TVMAZE_URL}/singlesearch/shows", params={"q": work or name}, timeout=_TIMEOUT
    )
    if shows.status_code == 404:
        return []
    shows.raise_for_status()
    show = shows.json()
    # singlesearch is fuzzy ("Gojo" finds "Sky Rojo"); a cast list is only useful when the
    # title really is what was typed.
    title = (show.get("name") or "").lower()
    if (work or name).lower() not in title:
        return []
    cast = await client.get(f"{TVMAZE_URL}/shows/{show['id']}/cast", timeout=_TIMEOUT)
    cast.raise_for_status()
    wanted = name.lower() if work else ""
    results = []
    for member in cast.json():
        character = member.get("character") or {}
        full = (character.get("name") or "").strip()
        if not full or (wanted and wanted not in full.lower()):
            continue
        # Never fall back to the actor's photo: that is a real person, not the character.
        image = character.get("image") or {}
        results.append({
            "name": full,
            "work": show.get("name") or "",
            "basedOn": _based_on(full, show.get("name") or ""),
            "description": "",
            "imageUrl": image.get("original") or image.get("medium") or "",
            "imageCredit": "TVMaze",
            "url": character.get("url") or show.get("url") or "",
            "source": "tvmaze",
        })
    return results[:5]


async def lookup(query: str) -> list[dict[str, Any]]:
    query = query.strip()[:120]
    if len(query) < 2:
        return []
    found = await asyncio.gather(
        search_anilist(query), search_tvmaze(query), return_exceptions=True
    )
    results: list[dict[str, Any]] = []
    for source, batch in zip(("anilist", "tvmaze"), found, strict=True):
        if isinstance(batch, BaseException):
            logger.warning("character lookup via %s failed: %s", source, type(batch).__name__)
            continue
        results.extend(batch)
    return results[:MAX_RESULTS]
