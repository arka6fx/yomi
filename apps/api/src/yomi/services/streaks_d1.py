"""D1 implementation of leaderboard and daily-streak stats.

Mirrors ``services/streaks.py``. Handle validation and shape constants stay
imported from the original so the two paths can never drift.
"""

from __future__ import annotations

from typing import Any

from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.streaks import HANDLE_PATTERN, LEADERBOARD_LIMIT

_STATS_COLS = (
    "current_streak, longest_streak, total_messages_sent, leaderboard_opt_in, "
    "leaderboard_handle, leaderboard_show_photo, image, plan"
)


def _stats_dict(row: dict[str, Any] | None) -> dict[str, Any]:
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
        "currentStreak": row.get("current_streak"),
        "longestStreak": row.get("longest_streak"),
        "totalMessagesSent": row.get("total_messages_sent"),
        "leaderboardOptIn": bool(row.get("leaderboard_opt_in")),
        "leaderboardHandle": row.get("leaderboard_handle"),
        "leaderboardShowPhoto": bool(row.get("leaderboard_show_photo")),
        "avatarUrl": row.get("image"),
        "plan": row.get("plan"),
    }


async def update_leaderboard_handle(
    backend: D1Backend, user_id: str, handle: str
) -> dict[str, object]:
    trimmed = handle.strip().lower()
    if not HANDLE_PATTERN.fullmatch(trimmed):
        return {
            "ok": False,
            "error": (
                "Handle must be 3-24 characters: lowercase letters, numbers, and "
                "dashes, starting with a letter."
            ),
        }
    taken = await backend.store.fetch_one(
        "SELECT id FROM user WHERE leaderboard_handle = ? AND id != ? LIMIT 1",
        [trimmed, user_id],
    )
    if taken is not None:
        return {"ok": False, "error": "That handle is already taken — try another."}
    await backend.store.atomic([
        Statement("UPDATE user SET leaderboard_handle = ? WHERE id = ?", [trimmed, user_id])
    ])
    return {"ok": True, "leaderboardHandle": trimmed}


async def set_leaderboard_show_photo(
    backend: D1Backend, user_id: str, show_photo: bool
) -> dict[str, bool]:
    await backend.store.atomic([
        Statement(
            "UPDATE user SET leaderboard_show_photo = ? WHERE id = ?",
            [1 if show_photo else 0, user_id],
        )
    ])
    return {"leaderboardShowPhoto": show_photo}


async def get_streak_stats(backend: D1Backend, user_id: str) -> dict[str, object]:
    row = await backend.store.fetch_one(
        f"SELECT {_STATS_COLS} FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    return _stats_dict(row)


async def set_leaderboard_opt_in(
    backend: D1Backend, user_id: str, opt_in: bool
) -> dict[str, object]:
    row = await backend.store.fetch_one(
        "SELECT leaderboard_handle FROM user WHERE id = ? LIMIT 1", [user_id]
    )
    await backend.store.atomic([
        Statement(
            "UPDATE user SET leaderboard_opt_in = ? WHERE id = ?",
            [1 if opt_in else 0, user_id],
        )
    ])
    return {"leaderboardOptIn": opt_in, "leaderboardHandle": (row or {}).get("leaderboard_handle")}


async def get_leaderboard(backend: D1Backend, user_id: str) -> dict[str, object]:
    rows = await backend.store.fetch_all(
        "SELECT id, leaderboard_handle, total_messages_sent, image, "
        "leaderboard_show_photo, plan FROM user "
        "WHERE leaderboard_opt_in = 1 AND deleted_at IS NULL "
        "ORDER BY total_messages_sent DESC, id ASC LIMIT ?",
        [LEADERBOARD_LIMIT],
    )
    entries = []
    for index, row in enumerate(rows):
        entries.append(
            {
                "rank": index + 1,
                "handle": row.get("leaderboard_handle") or "anonymous",
                "totalMessagesSent": row.get("total_messages_sent"),
                "isYou": str(row["id"]) == user_id,
                "avatarUrl": row.get("image") if row.get("leaderboard_show_photo") else None,
                "plan": row.get("plan"),
            }
        )

    in_top = next((e for e in entries if e["isYou"]), None)
    if in_top is not None:
        return {"entries": entries, "yourRank": in_top["rank"]}

    viewer = await backend.store.fetch_one(
        "SELECT leaderboard_opt_in, total_messages_sent FROM user WHERE id = ? LIMIT 1",
        [user_id],
    )
    if viewer is None or not viewer.get("leaderboard_opt_in"):
        return {"entries": entries, "yourRank": None}

    count_rows = await backend.store.fetch_all(
        "SELECT COUNT(*) AS n FROM user WHERE leaderboard_opt_in = 1 "
        "AND deleted_at IS NULL AND total_messages_sent > ?",
        [viewer.get("total_messages_sent") or 0],
    )
    return {"entries": entries, "yourRank": int(count_rows[0]["n"]) + 1}
