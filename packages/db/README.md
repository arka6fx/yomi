# @yomi/db (Python: `yomi-db`)

SQLAlchemy models for Yomi's **legacy Postgres path**.

> [!NOTE] Production stores data in Cloudflare D1, whose schema lives in
> `apps/api/migrations-d1/`. These models are used only when the backend runs
> with `STORAGE_BACKEND=postgres`, and by the Alembic migrations in
> `apps/api/migrations`. Schema changes go into a D1 migration first.

Provides the SQLAlchemy 2 async models (`packages/db/src/yomi/db/`) under the
`yomi.db` namespace — the same package name the schema always lived in, now
pulled out so the FastAPI backend (`apps/api`) and any tooling/alembic consume
one source of truth. `yomi` is a PEP 420 namespace package: this distribution
supplies the `db` subpackage, the backend supplies `app`, `services`, etc.

Engine/session wiring is intentionally **not** here — it needs `DATABASE_URL`
and app settings, so it lives in `apps/api/src/yomi/db_session.py`.

## Consume

In `apps/api/pyproject.toml`:

```toml
[project]
dependencies = ["yomi-db"]

[tool.uv.sources]
yomi-db = { path = "../../packages/db" }
```

## Lint

```bash
uv run ruff check src
```
