"""The web app's public character gallery must match the backend gallery."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_character_gallery.py"


def _exporter():
    spec = importlib.util.spec_from_file_location("export_character_gallery", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_exported_gallery_is_up_to_date():
    exporter = _exporter()
    assert exporter.OUT.read_text(encoding="utf-8") == exporter.render(), (
        "apps/web/src/data/character-gallery.json is stale: run "
        "`uv run python scripts/export_character_gallery.py` from apps/api"
    )


def test_export_never_includes_personality_prompts():
    exporter = _exporter()
    characters = json.loads(exporter.render())["characters"]
    assert characters and all("personality" not in c for c in characters)
    slugs = [c["slug"] for c in characters]
    assert len(slugs) == len(set(slugs))
    # these are static routes under /characters
    assert not {"guidelines", "tags"} & set(slugs)
