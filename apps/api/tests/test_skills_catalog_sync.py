"""The web's public skills catalog must mirror the backend's SKILLS."""

from __future__ import annotations

import re
from pathlib import Path

from yomi.services.skills import CATEGORIES, SKILLS

CATALOG = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "skills-catalog.ts"


def _web_skills() -> dict[str, dict[str, str]]:
    source = CATALOG.read_text(encoding="utf-8")
    body = source.split("export const SKILL_CATALOG", 1)[1]
    body = body.split("export const SKILL_CATEGORIES")[0]
    skills: dict[str, dict[str, str]] = {}
    for block in re.findall(r"\{(.*?)\n  \}", body, flags=re.S):
        fields = dict(re.findall(r'(\w+): "((?:[^"\\]|\\.)*)"', block))
        skills[fields["id"]] = fields
    return skills


def test_web_catalog_matches_backend_skills():
    web = _web_skills()
    assert set(web) == {s["id"] for s in SKILLS}, "apps/web/src/lib/skills-catalog.ts drifted"
    for skill in SKILLS:
        mirror = web[skill["id"]]
        assert mirror["name"] == skill["name"], skill["id"]
        assert mirror["kind"] == skill["kind"], skill["id"]
        assert mirror["category"] == skill["category"], skill["id"]
        assert mirror.get("schedule") == skill.get("schedule"), skill["id"]


def test_web_categories_match():
    source = CATALOG.read_text(encoding="utf-8")
    block = source.split("export const SKILL_CATEGORIES = [", 1)[1].split("]", 1)[0]
    assert re.findall(r'"([^"]+)"', block) == CATEGORIES
