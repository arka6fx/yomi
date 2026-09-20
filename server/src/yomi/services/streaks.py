"""Leaderboard + daily-streak stats.

Port of apps/backend/src/services/streaks.ts.
"""

from __future__ import annotations

import re

from sqlalchemy import asc, desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from yomi.db.models_auth import User

HANDLE_PATTERN = re.compile(r"^[a-z][a-z0-9-]{2,23}$")

LEADERBOARD_LIMIT = 50

HANDLE_ADJECTIVES = [
    "quiet",
    "swift",
    "brave",
    "calm",
    "bright",
    "bold",
    "gentle",
    "clever",
    "steady",
    "quick",
    "sharp",
    "keen",
    "wise",
    "eager",
    "vivid",
    "nimble",
]
HANDLE_NOUNS = [
    "falcon",
    "otter",
    "maple",
    "comet",
    "ember",
    "harbor",
    "willow",
    "granite",
    "cedar",
    "raven",
    "meadow",
    "quartz",
    "lynx",
    "aspen",
    "delta",
    "orbit",
]


def is_duplicate_handle_error(err: Exception) -> bool:
    return "user_leaderboard_handle_unique" in str(err)


async def update_leaderboard_handle(
    session: AsyncSession, user_id: str, handle: str
) -> dict[str, object]:
    """Returns {ok: True, leaderboardHandle} or {ok: False, error}."""
    trimmed = handle.strip().lower()
    if not HANDLE_PATTERN.fullmatch(trimmed):
        return {
            "ok": False,
            "error": (
                "Handle must be 3-24 characters: lowercase letters, numbers, and "
                "dashes, starting with a letter."
            ),
        }
    try:
        await session.execute(
            update(User).where(User.id == user_id).values(leaderboard_handle=trimmed)
        )
    except Exception as err:  # noqa: BLE001 — normalized below
        if is_duplicate_handle_error(err):  # type: ignore[arg-type]
            return {"ok": False, "error": "That handle is already taken — try another."}
        raise
    return {"ok": True, "leaderboardHandle": trimmed}


async def set_leaderboard_show_photo(
    session: AsyncSession, user_id: str, show_photo: bool
) -> dict[str, bool]:
    await session.execute(
        update(User).where(User.id == user_id).values(leaderboard_show_photo=show_photo)
    )
    return {"leaderboardShowPhoto": show_photo}


async def get_streak_stats(session: AsyncSession, user_id: str) -> dict[str, object]:
    row = (
        await session.execute(
            select(
                User.current_streak,
                User.longest_streak,
                User.total_messages_sent,
                User.leaderboard_opt_in,
                User.leaderboard_handle,
                User.leaderboard_show_photo,
                User.image,
                User.plan,
            ).where(User.id == user_id)
        )
    ).one_or_none()
    if row is None:
        return {
            "currentStreak": 0,
            "longestStreak": 0,
            "totalMessagesSent": 0,
            "leaderboardOptIn": False,
            "leaderboardHandle": None,
            "leaderboardShowPhoto": True,
            "avatarUrl": None,
            "plan": "explore",
        }
    return {
        "currentStreak": row.current_streak,
        "longestStreak": row.longest_streak,
        "totalMessagesSent": row.total_messages_sent,
        "leaderboardOptIn": row.leaderboard_opt_in,
        "leaderboardHandle": row.leaderboard_handle,
        "leaderboardShowPhoto": row.leaderboard_show_photo,
        "avatarUrl": row.image,
        "plan": row.plan,
    }


async def set_leaderboard_opt_in(
    session: AsyncSession, user_id: str, opt_in: bool
) -> dict[str, object]:
    handle = (
        await session.execute(
            select(User.leaderboard_handle).where(User.id == user_id).limit(1)
        )
    ).scalar_one_or_none()
    await session.execute(
        update(User).where(User.id == user_id).values(leaderboard_opt_in=opt_in)
    )
    return {"leaderboardOptIn": opt_in, "leaderboardHandle": handle}


async def get_leaderboard(session: AsyncSession, user_id: str) -> dict[str, object]:
    rows = (
        await session.execute(
            select(
                User.id,
                User.leaderboard_handle,
                User.total_messages_sent,
                User.image,
                User.leaderboard_show_photo,
                User.plan,
            )
            .where(User.leaderboard_opt_in.is_(True), User.deleted_at.is_(None))
            .order_by(desc(User.total_messages_sent), asc(User.id))
            .limit(LEADERBOARD_LIMIT)
        )
    ).all()

    entries = []
    for index, row in enumerate(rows):
        entries.append(
            {
                "rank": index + 1,
                "handle": row.leaderboard_handle or "anonymous",
                "totalMessagesSent": row.total_messages_sent,
                "isYou": row.id == user_id,
                "avatarUrl": row.image if row.leaderboard_show_photo else None,
                "plan": row.plan,
            }
        )

    in_top = next((e for e in entries if e["isYou"]), None)
    if in_top is not None:
        return {"entries": entries, "yourRank": in_top["rank"]}

    viewer = (
        await session.execute(
            select(User.leaderboard_opt_in, User.total_messages_sent)
            .where(User.id == user_id)
            .limit(1)
        )
    ).one_or_none()
    if viewer is None or not viewer.leaderboard_opt_in:
        return {"entries": entries, "yourRank": None}

    count = (
        await session.execute(
            select(func.count())
            .select_from(User)
            .where(
                User.leaderboard_opt_in.is_(True),
                User.deleted_at.is_(None),
                User.total_messages_sent > viewer.total_messages_sent,
            )
        )
    ).scalar_one()

    return {"entries": entries, "yourRank": count + 1}