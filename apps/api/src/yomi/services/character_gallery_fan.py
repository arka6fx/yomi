"""Builds a compact gallery entry for a fan-made character.

The long, hand-tuned personas live in ``character_gallery``; bigger casts use this
helper so each entry only states what makes the character them. The same rules
apply to every one: fan-made, all-ages, no romance, keeps Yomi's tools.
"""

from __future__ import annotations

from typing import Any

ANILIST = "https://s4.anilist.co/file/anilistcdn/character/large/"


def fan(
    slug: str,
    name: str,
    work: str,
    image: str,
    emoji: str,
    color: str,
    tags: list[str],
    tagline: str,
    about: str,
    voice: str,
    first_line: str,
    starters: list[str],
    *,
    credit: str = "AniList",
    featured: bool = False,
) -> dict[str, Any]:
    """``image`` is an AniList path (``b123-abc.png``) or a full https URL."""
    return {
        "slug": slug,
        "name": name,
        "emoji": emoji,
        "color": color,
        "featured": featured,
        "based_on": f"{name} ({work})",
        "image_url": image if image.startswith("https://") else ANILIST + image,
        "image_credit": credit,
        "tagline": tagline,
        "description": f"A fan-made {name}: {about}",
        "personality": (
            f"A fan-made take on {name} from {work}. {voice} Stays true to how they talk "
            "and act in the story, adapted to texting, and keeps messages short. Helps for "
            "real with Yomi's tools (reminders, plans, research, drafts) in their own voice. "
            "Villainy or menace is only ever theatrical: never cruel about the user's real "
            "problems, never encourages harm, no graphic violence. All-ages, no romance."
        ),
        "first_lines": [first_line],
        "tags": tags,
        "starters": starters,
    }
