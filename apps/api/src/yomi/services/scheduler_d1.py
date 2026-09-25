"""Fire due schedules into the durable run ledger (D1).

Called from the Worker's cron tick (``/internal/dispatch``) before due runs
are claimed. Each due schedule is claimed with a compare-and-set on
``next_run_at`` so two sweeps can't fire it twice, then becomes an
``agent_runs`` row keyed ``schedule:<id>:<due>`` (a retried tick dedupes)
that the sweeper executes and delivers to the user's Telegram chat.
"""

from __future__ import annotations

import logging
from typing import Any

from yomi.services import runs_d1
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import parse_dt, utcnow_iso
from yomi.services.schedule_parser import compute_next_run

logger = logging.getLogger(__name__)

FIRE_LIMIT = 10


def scheduled_input(row: dict[str, Any]) -> str:
    return (
        f"[Scheduled task: {row['schedule']}] {row['prompt']}\n"
        "(This runs automatically. Do the task now and reply with the result; "
        "don't ask follow-up questions.)"
    )


async def _telegram_chat(backend: D1Backend, user_id: str) -> str | None:
    row = await backend.store.fetch_one(
        "SELECT platform_chat_id FROM platform_connections WHERE user_id = ? "
        "AND platform = 'telegram' AND platform_chat_id IS NOT NULL LIMIT 1",
        [user_id],
    )
    return str(row["platform_chat_id"]) if row else None


async def fire_due_schedules(backend: D1Backend, limit: int = FIRE_LIMIT) -> int:
    """Queue one run per due schedule. Returns how many runs were queued."""
    now_iso = utcnow_iso()
    now = parse_dt(now_iso)
    due = await backend.store.fetch_all(
        "SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL "
        "AND next_run_at <= ? ORDER BY next_run_at LIMIT ?",
        [now_iso, limit],
    )
    queued = 0
    for row in due:
        next_run = compute_next_run(
            str(row["schedule_type"]), str(row["schedule"]),
            last_run_at=now, now=now, tz=row.get("timezone"),
        )
        # Never re-fire the same instant: a schedule that can't advance stops.
        if next_run is not None and next_run.isoformat() <= now_iso:
            next_run = None
        one_shot = bool(row.get("one_shot")) or next_run is None
        claimed = await backend.store.atomic([
            Statement(
                "UPDATE schedules SET next_run_at = ?, last_run_at = ?, "
                "run_count = run_count + 1, enabled = ?, last_run_status = 'queued', "
                "last_run_error = NULL, updated_at = ? "
                "WHERE id = ? AND next_run_at = ? RETURNING id",
                [
                    None if one_shot else next_run.isoformat(),
                    now_iso, 0 if one_shot else 1, now_iso,
                    row["id"], row["next_run_at"],
                ],
            )
        ])
        if not (claimed and claimed[0].get("results")):
            continue  # another sweep got it
        user_id = str(row["user_id"])
        chat_id = await _telegram_chat(backend, user_id)
        if chat_id is None:
            await backend.store.atomic([
                Statement(
                    "UPDATE schedules SET last_run_status = 'skipped', last_run_error = ? "
                    "WHERE id = ?",
                    ["Link Telegram to receive scheduled results", row["id"]],
                )
            ])
            continue
        plan_row = await backend.store.fetch_one('SELECT plan FROM "user" WHERE id = ?', [user_id])
        await runs_d1.create_run(
            backend,
            user_id=user_id,
            chat_id=chat_id,
            update_id=f"schedule:{row['id']}:{row['next_run_at']}",
            kind="schedule",
            input_text=scheduled_input(row),
            plan=str((plan_row or {}).get("plan") or "explore"),
        )
        queued += 1
    return queued
