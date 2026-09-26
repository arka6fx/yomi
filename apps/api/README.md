# Yomi backend

The FastAPI backend behind `api.getyomi.in`. It runs in a Cloudflare Container
behind a thin Worker and stores data in D1, Vectorize, and R2 through a storage
gateway Worker. See [`docs/architecture.md`](../../docs/architecture.md) for the
full picture.

## Layout

```text
apps/api/
├── src/yomi/
│   ├── app/            FastAPI app, dependencies, and REST routes (/api/*)
│   ├── gateway/        Telegram webhook
│   ├── services/       Agent loop, memory, RAG, billing, D1 data access
│   ├── connectors/     Gmail, Calendar, Drive tool sets and the Composio bridge
│   ├── conf.py         Settings (read from the environment)
│   └── run.py          Production entrypoint (uvicorn on :8080)
├── containers/         Cloudflare Workers: backend router and storage gateway
├── migrations-d1/      D1 schema, as numbered SQL migrations
├── migrations/         Alembic scripts for the legacy Postgres path
├── scripts/            One-off tooling (schema generation, data migration)
├── tests/              pytest suite
├── Dockerfile          Container image
├── wrangler.toml                 Backend Worker + Container
├── wrangler.storage.toml         Storage gateway (staging)
└── wrangler.storage-prod.toml    Storage gateway (production)
```

## Development

```bash
uv sync --dev
cp .env.example .env
uv run uvicorn yomi.run:app --reload --port 8080
```

Settings and their defaults are in [`src/yomi/conf.py`](./src/yomi/conf.py).
Local development needs at least the Cloudflare account ID and API token
(Workers AI) and a storage gateway URL and secret. The staging gateway works for
this.

## Tests and lint

```bash
uv run pytest -q
uv run ruff check .
```

Tests run against an in-memory SQLite database that mirrors the D1 schema
(`tests/d1_sqlite.py`). They make no real network or model calls.

## Adding a D1 migration

1. Add the next numbered file to `migrations-d1/`, such as
   `0014_add_widgets.sql`. Keep it additive.
2. Update the tests that exercise the new tables.
3. Apply it to staging and then production **before** deploying the code (see
   the [runbook](../../docs/runbook.md#database-migrations-d1)).

## Deployment

Pushing to `main` deploys the backend through
`.github/workflows/deploy-backend.yml`. The storage gateway, D1 migrations, and
secrets are managed by hand. Everything is in the
[production runbook](../../docs/runbook.md).

## Status

| Area                                        | State                                                    |
| ------------------------------------------- | -------------------------------------------------------- |
| Telegram gateway, agent loop, approvals     | Production                                               |
| Auth (Telegram sign-in, Google, GitHub)     | Production                                               |
| Billing and credits (Dodo Payments)         | Production                                               |
| Memory, RAG, routines, vault, email         | Production                                               |
| Computer use (Browser Run, sandbox desktop) | Production                                               |
| First-class connectors                      | Gmail, Calendar, Drive native; the rest through Composio |
