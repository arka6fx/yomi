"""Turn-aware contradiction candidates for memory extraction.

Port of apps/api/src/services/memory/contradiction.ts. The ~20 nearest
active memories to the full turn are shown to the extraction call so it can name
what a correction replaces by id instead of guessing a topic string (ADR 0006).
"""

from __future__ import annotations

import json
from typing import Any, TypedDict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.services.memory.embeddings import embed_memory_text, memory_vector_literal

TURN_CANDIDATE_LIMIT = 20
CANDIDATE_CONTENT_CHARS = 240


class TurnCandidate(TypedDict):
    id: str
    kind: str
    topic: str
    summary: str | None
    content: str


def turn_text_for(input_text: str, output_text: str) -> str:
    return f"User: {input_text}\nAssistant: {output_text}"


# Best-effort by design: every failure yields an empty candidate set, so the
# turn's memories are still stored — just without a supersession — rather than
# lost.
async def fetch_turn_candidates(
    session: AsyncSession, user_id: str, turn: str
) -> list[TurnCandidate]:
    if not turn.strip():
        return []
    embedding = await embed_memory_text(turn)
    if not embedding:
        return []
    vector = memory_vector_literal(embedding)
    try:
        result = await session.execute(
            text(
                f"""
                select e.id as "id",
                       e.kind as "kind",
                       e.topic as "topic",
                       e.summary as "summary",
                       e.content as "content"
                from memory_embeddings me
                join memory_entries e on e.id = me.memory_id
                where me.user_id = :user_id
                  and e.status = 'active'
                  and e.is_latest = true
                order by me.embedding <=> '{vector}'::vector
                limit :limit
                """
            ),
            {"user_id": user_id, "limit": TURN_CANDIDATE_LIMIT},
        )
    except Exception:
        return []
    rows = [dict(row) for row in result.mappings()]
    return [
        {
            "id": row["id"],
            "kind": str(row.get("kind") or "fact"),
            "topic": str(row.get("topic") or ""),
            "summary": row.get("summary"),
            "content": str(row.get("content") or ""),
        }
        for row in rows
        if isinstance(row.get("id"), str)
    ]


def render_turn_candidates(candidates: list[TurnCandidate]) -> str:
    if not candidates:
        return "(none stored yet)"
    rendered = []
    for candidate in candidates:
        body = (candidate["summary"] or candidate["content"])[:CANDIDATE_CONTENT_CHARS]
        rendered.append(
            f"- id={candidate['id']} [{candidate['kind']}] "
            f"{candidate['topic']}: {body}"
        )
    return "\n".join(rendered)


# Kept in sync with the "Memory contradiction" section of CONTEXT.md — if the
# definitions drift, the model starts superseding elaborations.
CONTRADICTION_RULES = """\
- contradiction: the new memory is incompatible with a listed one about the same subject ("uses vim" -> "switched to VS Code"). Set replaces_id to that memory's id.
- duplicate: the same claim, only reworded ("uses vim" -> "is a vim user"). Leave replaces_id out.
- elaboration: compatible with a listed one and adds detail ("uses vim" -> "uses vim with a custom leader key"). Leave replaces_id out.

Test a pairing by asking whether both statements can be true of the user at the same time. "Uses vim" and "uses vim with a custom leader key" can both be true, so that is an elaboration and replaces_id stays out. "Uses vim" and "is a vim user" say the same thing in different words, so that is a duplicate and replaces_id stays out. "Uses vim" and "switched to VS Code" cannot both be true, so that is a contradiction. Same subject, more detail, or more recent wording is never enough on its own — only the listed memory being wrong now. A restatement of a listed memory is a duplicate however much better it is worded, and duplicates are stored alongside, so replaces_id stays out. Before emitting replaces_id, say to yourself what the listed memory claims and what became false about it; if nothing did, omit replaces_id."""

# Kept in sync with the Static entry of CONTEXT.md's "Memory contradiction"
# section — if this drifts, marking every extracted preference and fact static
# makes a stale one permanently resident in the prompt (#87).
STATIC_RULE = """\
is_static is true only for a durable identity or standing fact — the user's name, role, timezone, or a standing instruction they gave for all future turns ("always cc my manager"). It is not derived from kind: an ordinary preference, project detail, or one-off fact is not static even when it is a "preference" or "fact" kind. When unsure, use false — a false-negative here is merely not injected on every turn, a false-positive never leaves the prompt."""


def build_extraction_prompt(
    input_text: str, output_text: str, candidates: list[TurnCandidate]
) -> str:
    return f"""\
Extract durable user memory from this Yomi backend-agent interaction.

Return strict JSON only:
{{"memories":[{{"kind":"preference|fact|project|decision|open_thread|correction","scope":"global|project|app|session","topic":"short key","content":"one concise memory","confidence":0.0,"is_static":false,"replaces_id":"omit unless this turn makes a listed memory false"}}]}}

Rules:
- Store only useful future context.
- Do not store secrets, passwords, API keys, or one-off trivia.
- Prefer high precision. If uncertain, omit it.

Memories already stored for this user:
{render_turn_candidates(candidates)}

replaces_id retires a listed memory: the one it names stops being part of what you know about this user. Set it only for a contradiction, and only to an id exactly as listed above:
{CONTRADICTION_RULES}

{STATIC_RULE}

{turn_text_for(input_text, output_text)}"""


class ExtractedMemory(TypedDict, total=False):
    kind: str
    scope: str
    topic: str
    content: str
    confidence: float
    is_static: Any
    replaces_id: Any


def parse_extracted_memories(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(parsed, dict):
        return []
    memories = parsed.get("memories")
    return [m for m in memories if isinstance(m, dict)] if isinstance(memories, list) else []


# A supersession destroys a live memory, so only an id the model was actually
# shown is acted on.
def pick_replaces_id(value: Any, candidates: list[TurnCandidate]) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate_id = value.strip()
    return candidate_id if any(c["id"] == candidate_id for c in candidates) else None


# Deliberately not derived from kind (#87) — see the Static entry of CONTEXT.md's
# "Memory contradiction" section. Anything other than an explicit true, including
# a missing or malformed judgment, defaults to false: the safe failure direction
# per STATIC_RULE above.
def resolve_is_static(memory: dict[str, Any]) -> bool:
    return memory.get("is_static") is True