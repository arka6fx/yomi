# Contributing to Yomi

Thanks for contributing! Yomi is a personal AI assistant on Telegram: a FastAPI
backend (Python, `server/` — canonical for everything it covers), a Next.js
dashboard, and a Bun workspace. The legacy Hono backend (`apps/backend`) still
runs production surfaces the Python port hasn't covered yet. This guide keeps
changes reviewable and CI green.

## Getting started

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi

# Python backend (canonical for new backend work)
cd server
uv sync --dev
cp .env.example .env     # fill in at minimum the OpenAI + Postgres values
uv run uvicorn yomi.app.main:app --reload --port 3001

# Dashboard
cd ../apps/landing
bun install
bun run dev
```

Dev targets: backend on `http://localhost:3001`, dashboard on
`http://localhost:3000`.

## Repo layout

```text
server/                  FastAPI backend (Python): models, services, routers,
                         alembic migrations, tests
apps/backend/            TypeScript backend (Hono on Workers) — production until
                         the Python port completes
apps/landing/            Next.js on Workers: marketing, dashboard, account linking
packages/agent-core/     (TS) ConnectorDef, ConnectorRegistry, agent tools
packages/db/             (TS) Drizzle schema + Postgres client (Neon HTTP driver)
packages/shared/         (TS) TypeScript contracts shared across apps
packages/ui-connectors/  (TS) Connector UI components
```

New backend work goes into `server/` (FastAPI + SQLAlchemy 2 async). Python
code is linted with `ruff` (line length 100) and tested with `pytest`;
TypeScript as described below. The `server/` CI job is
`.github/workflows/python-ci.yml`.

## What to work on

Open issues with `needs-triage` / `ready-for-agent` labels are the best place to
start. See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) for
the label vocabulary and `docs/agents/triage-labels.md`.

Architecture decisions are recorded in [`docs/adr/`](docs/adr). If your change
makes a structural decision, add an ADR ([`docs/adr/0000-template.md`](docs/adr/0000-template.md)).

## Development workflow

1. Create a branch: `git checkout -b feat/my-change` (or `fix/`).
2. Make focused commits. Conventional commits, lowercase, max 72 chars, no
   trailing full stop:
   ```text
   feat: add ...    fix: correct ...    refactor: ...
   perf: ...        style: ...          test: ...
   chore: ...       docs: ...
   ```
3. Before pushing, make sure your package is clean:

   ```bash
   # TypeScript workspace
   bun run typecheck   # all packages, via turbo
   bun run lint
   bun run test
   bun run format      # prettier; CI runs format:check, so match it

   # Python backend (server/)
   cd server && uv run ruff check .
   cd server && uv run pytest -q
   ```

   CI runs the same checks plus a docs sync check — a red build won't deploy.

## Test conventions

- Python tests live in `server/tests/` (pytest, async-oriented; no real
  network/LLM calls — mock httpx/DB as the `tests/test_memory_*` suites do).
- TypeScript tests are colocated next to the code they exercise
  (`apps/backend/src/routes/usage.test.ts`) and run under `bun test`.
- Skip real network/LLM calls in tests; mock `fetch` or module dependencies.
- Don't assert on private implementation details; test behavior.

## Code style

- One-liner comments on non-obvious logic only; never multi-line docstrings.
- No unused imports, no `as any` in non-test files, no noisy production debug
  logs. Empty catches use `// ignore` or `// best-effort`.
- Never commit secrets. Real env values stay in gitignored `.env*` files and
  Worker secrets — only `.env.example` templates go in the repo.

## Pull requests

- Base your PR on `main`.
- Reference the issue it closes: `Closes #123`.
- Keep PRs small and focused; a large change is usually several PRs.
- The maintainer may ask for changes; discussion happens in the review thread.

## Privacy & safety

User data is sensitive. If your change touches memory, encryption, retention,
or PII handling, call it out in the PR description and keep the existing
privacy guarantees intact (see `README.md` → Privacy).

## Code of conduct

By contributing you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Be respectful; this is a small maintainer-run project and every contribution is
appreciated.

## Reporting security issues

Do **not** open a public issue for a security vulnerability. See
[`SECURITY.md`](SECURITY.md) for how to report it privately.