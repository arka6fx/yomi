# apps/api: backend guide

The FastAPI backend. Repo-wide rules are in the root `AGENTS.md`; this file
covers how code is written here. Commands run from `apps/api`.

## Commands

```bash
uv run pytest -q                          # whole suite, ~15s
uv run pytest -q tests/test_trust_d1.py   # one file
uv run ruff check .                       # lint (CI runs this)
uv run uvicorn yomi.run:app --reload --port 8080
```

`ruff format` is not enforced repo-wide. Don't reformat files you aren't
changing.

## Data access: D1 only

Production runs `STORAGE_BACKEND=d1`. New code talks to D1 through a
`services/<area>_d1.py` module and never uses SQLAlchemy sessions or
`packages/db` models. Those serve only the legacy Postgres fallback.

```python
from yomi.services.cloudflare_storage.client import Statement
from yomi.services.cloudflare_storage.deps import D1Backend
from yomi.services.cloudflare_storage.store import utcnow_iso

row = await backend.store.fetch_one("SELECT * FROM t WHERE id = ?", [item_id])
rows = await backend.store.fetch_all("SELECT ...", [user_id])
await backend.store.atomic([                     # one D1 transaction
    backend.store.insert("t", {"id": ..., "created_at": utcnow_iso()}),
    Statement("UPDATE t SET status = ? WHERE id = ?", ["done", item_id]),
])
```

- Always scope queries by `user_id`.
- Timestamps are ISO-8601 UTC strings (`utcnow_iso()`), not datetimes.
- Use `UPDATE ... RETURNING` inside `atomic` for compare-and-set.

## Schema changes

1. Add the next numbered file to `migrations-d1/` (look at the highest number
   first). Keep it additive: `CREATE TABLE IF NOT EXISTS`, new nullable columns,
   and indexes.
2. Tests pick it up automatically: `tests/d1_sqlite.py` runs every migration
   into in-memory SQLite.
3. Say in the PR that it needs `wrangler d1 migrations apply` before deploy.
   Never apply it to remote databases yourself.

## Routes

Routers live in `app/routes/<area>.py` and are mounted in `app/main.py`. Follow
`app/routes/trust.py`:

```python
@router.get("")
async def handler(
    user: User = Depends(get_current_user),
    d1: D1Backend | None = Depends(get_d1_backend),
):
    return await area_d1.overview(_require(d1), user.id)
```

Validate bodies with Pydantic models, map domain errors to `HTTPException`, and
gate memory and RAG routes with `require_consent(...)`.

## Agent tools

Tools are registered per request in `services/agent/tools.py`. Group new tools
in `services/agent/<area>_tools.py` with a
`register_<area>_tools(tool_registry, backend, user_id, ...)` function (see
`trust_tools.py`). Tools return JSON strings.

Anything with side effects (sending, booking, paying, deleting, messaging
someone) must go through `create_pending_action` so the user approves it first.
Don't add a tool that acts irreversibly without that step.

## Plans and usage

Free and Pro only; credits are retired. Still call
`services/billing_d1.charge_usage()` for every billable action: it logs the
usage event (pass an `idempotency_key` when a retry could log twice) but never
blocks. The real plan gate is the routine cap in `services/schedule_parser.py`
(`SCHEDULE_LIMITS`), and Pro gets the `agent` engine in
`services/agent/loop.py`. Plan definitions live in `shared/plans.py`; keep
`apps/web/src/lib/plans.ts` in step.

## Telegram

`gateway/telegram.py` handles the webhook. Messages become background agent runs
(`services/runs_d1.py`). Inline buttons arrive as `callback_query` updates
routed by prefix in `_handle_callback` (`act:` approvals, `login:` web sign-in).
Use `send_message()` for replies. It converts Markdown to Telegram HTML and
chunks long text.

## Tests

- pytest with `asyncio_mode = "auto"`: write `async def test_...` directly.
- Use `from d1_sqlite import sqlite_backend` for a real schema in memory.
- Never hit the network. Monkeypatch `_telegram_call`, `send_message`, or
  `httpx.AsyncClient` (with `httpx.MockTransport`) and model calls.
- Add or extend a test with every behavior change.

## Settings and secrets

Settings are fields on `conf.py` `Settings`, read from the environment. A new
secret also needs:

1. an entry in `envVars` and the `Env` type in `containers/worker.ts` (or the
   container never sees it),
2. a line in `.env.example`, and
3. a row in the secrets table in `docs/runbook.md`.
