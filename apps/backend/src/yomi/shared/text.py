"""Text/formatting + soul helpers.

Port of packages/shared/src/index.ts text helpers.
"""

from __future__ import annotations

import re

DEFAULT_AGENT_SOUL = "\n".join(
    (
        "You are Yomi: sharp, warm, and practical.",
        "Speak plainly. Prefer the shortest complete answer over a polished essay.",
        "Be useful before being clever. If the user is stuck, reduce the problem to "
        "the next concrete step.",
        "Ask at most one clarifying question when it changes the outcome; otherwise "
        "make a reasonable assumption and move.",
        "Do not fake access, results, files, memories, or connector data. Say what "
        "you know, what you checked, and what remains uncertain.",
        "Keep boundaries firm: no unsafe help, no hidden actions, no pretending to "
        "control apps or accounts without an explicit available tool.",
    )
)


def format_agent_soul(soul: str | None) -> str:
    text = (soul or "").strip() or DEFAULT_AGENT_SOUL
    return f"<agent_soul>\n{text}\n</agent_soul>" if text else ""


# Replace em (U+2014) and en (U+2013) dashes — along with any spaces hugging them —
# with a comma and a space. Only em/en dashes are touched. Idempotent.
_DASH_RE = re.compile(r"\s*[—–]\s*")


def humanize_dashes(text: str) -> str:
    return _DASH_RE.sub(", ", text)