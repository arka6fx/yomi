# Yomi

> A personal AI assistant that lives in Telegram.

[Website](https://getyomi.in) · [Dashboard](https://getyomi.in/dashboard) ·
[Telegram bot](https://t.me/yomi_assistant_bot) · [Docs](https://getyomi.in/docs) ·
[MIT license](./LICENSE)

Send Yomi a text, voice note, or photo. It can work across Gmail, Google
Calendar, Drive, GitHub, Slack, Notion, Linear, and other connected services.
Yomi asks before sending, booking, deleting, or taking another irreversible
action.

The web app is the management dashboard. Use Telegram to chat with Yomi; use
the dashboard to connect services, manage memory, create schedules, and review
credits.

## What it does

| Capability | Description |
| --- | --- |
| Telegram | Text, voice-note transcription, and image analysis. Replies are text. |
| Connectors | First-class Gmail, Calendar, Drive, GitHub, Slack, Notion, and Linear tools, plus Composio connectors. |
| Memory | User-owned memory stored in Postgres and available to the agent across sessions. |
| RAG | Index text, URLs, documents, and connected Drive content for retrieval. |
| Schedules | Run recurring briefings, reports, and checks on a credit budget. |
| Approvals | Preview sensitive actions before they happen. |
| Dashboard | Manage account linking, billing, credits, schedules, memory, and privacy. |

## Architecture

```text
Telegram ────────┐
                 ▼
          Cloudflare Worker
                 ▼
       FastAPI Python container
          │       │       │
          │       │       └── Workers AI: chat, search, embeddings, speech
          │       └────────── Connectors and Composio
          └────────────────── Neon Postgres + pgvector

Next.js dashboard ──────────── FastAPI API
```

The Python backend is canonical. It owns authentication, billing, metering,
the Telegram gateway, the agent loop, connector access, memory, and RAG. The
dashboard never accesses Postgres directly.

## Stack

| Layer | Technology |
| --- | --- |
| Backend | FastAPI, SQLAlchemy 2 async, Alembic |
| Runtime | Cloudflare Containers and Workers |
| Database | Neon PostgreSQL with pgvector |
| Models | Cloudflare Workers AI (`qwen3.8-27b`, `whisper`, `bge-base-en-v1.5`) |
| Dashboard | Next.js and React |
| Billing | Dodo Payments |
| Storage | Cloudflare R2 |

## Plans and credits

Credits are the single usage balance for all plans and connectors.

| Plan | Price | Credits |
| --- | --- | ---: |
| Explore | Free | 100/month |
| Pro | $5/month | 300/month |
| Max | $40/month | 750/month |

Credit packs are also available. See the [plans documentation](https://getyomi.in/docs#plans--credits)
for current details.

## Quickstart

Prerequisites: Node.js 22+, [`uv`](https://docs.astral.sh/uv/), and the
environment values documented in [`apps/api/.env.example`](./apps/api/.env.example).

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi

# Install JavaScript dependencies
npm install

# Configure and run the Python backend
cp apps/api/.env.example apps/api/.env
npm run python:dev                 # http://localhost:8080

# In another terminal, run the dashboard
npm run dev --workspace @yomi/web  # http://localhost:3000
```

The backend uses a real Postgres connection. For Python-only development:

```bash
cd apps/api
uv sync --dev
uv run pytest -q
uv run ruff check .
```

## Repository layout

```text
apps/api/       FastAPI backend, agent loop, connectors, migrations, tests
apps/web/       Next.js marketing site and dashboard
packages/db/    Shared Python SQLAlchemy schema (`yomi-db`)
packages/shared TypeScript contracts shared across apps
packages/ui/    Connector catalog and dashboard UI components
docs/           Architecture decisions and agent workflows
specs/          Product and connector specifications
```

## Checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test

cd apps/api
uv run ruff check .
uv run pytest -q
```

## Deployment

Pushes to `main` deploy through GitHub Actions when the relevant application
changes:

- `apps/web/**` → dashboard and marketing site on Cloudflare Workers
- `apps/api/**` or `packages/db/**` → FastAPI backend on Cloudflare Containers

Database migrations are separate from deploys. Run them with Alembic after
reviewing the migration:

```bash
cd apps/api
uv run alembic upgrade head
```

See [`RUNBOOK.md`](./RUNBOOK.md) for production operations and
[`apps/api/README.md`](./apps/api/README.md) for backend deployment details.

## Documentation

- [`AGENTS.md`](./AGENTS.md) — repository instructions and architecture summary
- [`CONTEXT.md`](./CONTEXT.md) — domain vocabulary
- [`specs/00-overview.md`](./specs/00-overview.md) — system overview
- [`specs/connectors/00-index.md`](./specs/connectors/00-index.md) — connector catalog
- [`docs/adr/`](./docs/adr/) — architecture decisions
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — contribution workflow
- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting

## Contributing

Use a focused branch and a conventional commit such as `feat: add calendar
digest` or `fix: handle expired connector token`. Run the checks above before
opening a pull request. Issues and feature requests belong in
[GitHub Issues](https://github.com/arka6fx/yomi/issues).
