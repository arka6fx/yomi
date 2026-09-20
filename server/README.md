# Yomi backend (FastAPI)

FastAPI port of `apps/backend` (Hono on Cloudflare Workers) + `packages/*`
for the Yomi assistant. Keeps the same Postgres schema and data.

## Layout

- `src/yomi/db` — SQLAlchemy 2 async models mirroring `packages/db/src/schema.ts`
- `src/yomi/shared` — ports of `packages/shared`
- `src/yomi/services` — ports of `apps/backend/src/services`
- `src/yomi/app` — FastAPI app (deps, routers)

## Run

```bash
uv sync --dev
uv run uvicorn yomi.app.main:app --reload --port 3001
```

Set required values in `server/.env` (see `src/yomi/conf.py`).

## Test / lint

```bash
uv run pytest
uv run ruff check
```