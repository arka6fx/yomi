"""Write the public character gallery to the web app for its prerendered pages.

The marketing pages (/characters, /characters/<slug>, /characters/tags/<tag>) are
static, so they read this JSON instead of the signed-in /api/characters. Only public
fields are exported: never the ``personality`` prompt. Run after editing the gallery:

    uv run python scripts/export_character_gallery.py

tests/test_character_gallery_export.py fails when the file is out of date.
"""

from __future__ import annotations

import json
from pathlib import Path

from yomi.services import characters_d1

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "data" / "character-gallery.json"

PUBLIC_FIELDS = (
    "name", "emoji", "color", "tagline", "description", "firstLines", "starters",
    "tags", "basedOn", "featured", "imageUrl", "imageCredit",
)


def render() -> str:
    characters = [
        {"slug": c["id"].removeprefix(characters_d1.GALLERY_PREFIX)}
        | {key: c[key] for key in PUBLIC_FIELDS}
        for c in characters_d1.gallery()
    ]
    payload = {"tags": characters_d1.TAGS, "characters": characters}
    return json.dumps(payload, ensure_ascii=False, indent=1) + "\n"


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(), encoding="utf-8")
    print(f"wrote {OUT.relative_to(Path.cwd().parents[1])}")
