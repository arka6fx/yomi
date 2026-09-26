---
description: Add a D1 schema migration with tests
argument-hint: <what the migration adds>
---

Add a D1 migration for: $ARGUMENTS

1. List `apps/api/migrations-d1/` and use the next number, e.g.
   `0014_short_name.sql`.
2. Write additive SQL only: `CREATE TABLE IF NOT EXISTS`,
   `ALTER TABLE ... ADD COLUMN` with a nullable column or a default, and
   `CREATE INDEX IF NOT EXISTS`. Timestamps are `TEXT` in ISO-8601 UTC. Every
   user-owned table has a `user_id` column and an index on it.
3. Add or update the `services/*_d1.py` code and a test that uses
   `d1_sqlite.sqlite_backend()`, which applies every migration.
4. Update the table list in `docs/specs/11-database.md`.
5. Run `cd apps/api && uv run pytest -q && uv run ruff check .`.

Do not apply the migration to staging or production. Tell the user to run
`wrangler d1 migrations apply` (see `docs/runbook.md`) before the code deploys.
