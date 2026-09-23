<div align="center">
  <img src="assets/yomi-banner.svg" alt="Yomi" width="100%" />
</div>

# Yomi

**The AI assistant that lives in your Telegram.** Text it, talk to it, or send
a photo — Yomi drafts email, summarizes threads, schedules meetings, searches
your files, files tasks, and acts across your Google Workspace, GitHub, Slack,
Notion, and Linear. It asks before it acts.

[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](./LICENSE)
[![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?style=flat-square&logo=python&logoColor=white)](./apps/api)
[![Frontend](https://img.shields.io/badge/Frontend-Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white)](./apps/web)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)](./apps/api/pyproject.toml)
[![CI](https://img.shields.io/github/actions/workflow/status/arka6fx/yomi/ci.yml?branch=main&label=TS%20CI&style=flat-square)](https://github.com/arka6fx/yomi/actions/workflows/ci.yml)
[![Python CI](https://img.shields.io/github/actions/workflow/status/arka6fx/yomi/python-ci.yml?branch=main&label=Python%20CI&style=flat-square)](https://github.com/arka6fx/yomi/actions/workflows/python-ci.yml)
[![Telegram](https://img.shields.io/badge/Telegram-%40yomi_assistant_bot-2CA5E0?style=flat-square&logo=telegram&logoColor=white)](https://t.me/yomi_assistant_bot)

---

Yomi is a personal AI assistant on Telegram. There is no desktop app and no web
chat — Telegram *is* the interface. Send a text, a voice note, or a photo, and
the backend reads and drafts email, summarizes threads, schedules meetings,
files tasks, and keeps your tools in sync. The website is only a dashboard for
linking services, setting schedules, reviewing memory, and checking credits.

## What makes it cool

**Lives where you already work.** No new app to install. Open a Telegram chat,
record a voice note, snap a photo, and Yomi goes to work across the tools you
use every day — with explicit approval before anything irreversible happens.

**A closed learning loop.** Yomi keeps canonical, user-owned memory in
Postgres with pgvector. New facts are cross-checked against what it already
knows (contradiction resolution at extraction), duplicates are merged by a
consolidation sweep, and session summaries compound into a deepening model of
who you are — across chats, days, and projects.

**First-class connectors, plus 40+ more.** Hand-written tool sets for Gmail,
Google Calendar, Drive, Classroom, Tasks, Meet, GitHub, Slack, Notion, and
Linear — and dozens of long-tail services through Composio, all approval-gated
and metered.

**Backend-first, client-thin.** Durable memory, connector credentials, and the
agent loop live in the cloud backend, not on your laptop. The Telegram client
stays dumb; the backend thinks, uses tools, and replies.

**Scheduled automations.** Built-in cron for daily briefings, reports, and
recurring checks — planned on a credit budget, delivered to Telegram.

**A growing RAG archive.** `index_text`, `index_url`, and `index_document`
write into your searchable archive; `deep_research` answers from it. Your
notes, links, and documents compound instead of rotting in folders.

**Fair metering.** A single credit balance is the only usage gate — one
balance, all connectors, no per-feature caps. There's a free Explore plan and
unlimited connectors on every plan.

## Works with

[![Gmail](https://img.shields.io/badge/Gmail-D14836?style=flat-square&logo=gmail&logoColor=white)](https://mail.google.com)
[![Google Calendar](https://img.shields.io/badge/Calendar-4285F4?style=flat-square&logo=googlecalendar&logoColor=white)](https://calendar.google.com)
[![Google Drive](https://img.shields.io/badge/Drive-EA4335?style=flat-square&logo=googledrive&logoColor=white)](https://drive.google.com)
[![Google Classroom](https://img.shields.io/badge/Classroom-0F9D58?style=flat-square&logo=googleclassroom&logoColor=white)](https://classroom.google.com)
[![Google Tasks](https://img.shields.io/badge/Tasks-26A69A?style=flat-square&logo=googletasks&logoColor=white)](https://tasks.google.com)
[![Google Meet](https://img.shields.io/badge/Meet-00897B?style=flat-square&logo=googlemeet&logoColor=white)](https://meet.google.com)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white)](https://github.com)
[![Slack](https://img.shields.io/badge/Slack-4A154B?style=flat-square&logo=slack&logoColor=white)](https://slack.com)
[![Notion](https://img.shields.io/badge/Notion-000000?style=flat-square&logo=notion&logoColor=white)](https://www.notion.so)
[![Linear](https://img.shields.io/badge/Linear-5E6AD2?style=flat-square&logo=linear&logoColor=white)](https://linear.app)

…plus Docs, Sheets, Slides, Discord, WhatsApp, LinkedIn, Outlook, Teams,
OneDrive, Dropbox, Figma, YouTube, Zoom, Jira, Trello, Asana, Todoist, Reddit,
Stripe, Salesforce, HubSpot, Microsoft 365, and more — the full catalog lives in
[`specs/connectors/00-index.md`](specs/connectors/00-index.md).

## Try Yomi

The fastest way to feel it: send a message to
[**@yomi_assistant_bot**](https://t.me/yomi_assistant_bot) on Telegram — text,
voice note, or a photo.

Prefer to run it yourself? Skip to
[Local Development](#local-development).

## How it works

Yomi is backend-first. Durable memory, connector credentials, and the agent
loop all live in the cloud backend, so the client stays thin. Telegram sends
your message to the backend; the backend thinks, uses tools, and replies.

```text
                 Telegram
          text / voice / images
                    │
                    ▼
      ┌────────────────────────────┐
│       BACKEND           │
      │  FastAPI (Python, apps/api/) │
      │  SQLAlchemy 2 async        │
      │                            │
      │auth, billing, LLM proxy,   │
      │metering, scheduler,        │
      │memory (pgvector)           │
      └────────────┬───────────────┘
                   │
             ┌─────┴─────┐
             │           │
             ▼           ▼
             Connectors  Postgres (Neon)
             first-class pgvector
             + Composio
                  │
                  └── Dashboard (Next.js on Workers)
                      account linking, schedules, memory,
                      credits — all data via the backend API
```

The backend is the only thing that talks to Postgres; the dashboard reaches the
database, connectors, and memory through the backend API.

> **Port complete.** The backend was rewritten from TypeScript (Hono on
> Cloudflare Workers) to Python (FastAPI in a Cloudflare Container).
> `apps/api/` is canonical for everything it covers — privacy, schedules,
> memory, RAG, metering, billing, LLM, referrals, streaks, the agent loop, and
> the Telegram gateway. Shared schema lives in `packages/db` (`yomi-db`,
> SQLAlchemy 2 async). Same Postgres schema, same data, same API shape.

### Request model

Every request is one of two shapes, and the model never switches mid-turn —
that would drop the prompt cache and mismatch the tool vocabulary.

| Request type   | Path                                | Budget             |
| -------------- | ----------------------------------- | ------------------ |
| Connector task | Agent loop + connector tools        | seconds to minutes |
| Telegram task  | Backend agent + memory/tool harness | seconds to minutes |

### Memory

Yomi keeps a small notepad in `~/.yomi/`, loaded just-in-time:

```text
yomi.md        ALWAYS preloaded: identity, prefs, standing instructions
memory.md      Long-term memory (curated, compacted)
projects/<p>/  context.md, scratchpad.md
sessions/      YYYY-MM-DD-topic.md summaries
```

Backend memory stays canonical for durable facts, document provenance,
Telegram, and connector agents — encrypted at rest, user-owned, always
exportable and deletable.

## Stack

| Layer          | Choice                                                   |
| -------------- | -------------------------------------------------------- |
| Backend        | FastAPI + SQLAlchemy 2 async + Alembic (`apps/api/`)   |
| LLM            | Cloudflare Workers AI (`qwen3.8-27b` fast + agent)       |
| Speech-to-text | Workers AI `whisper` (replies are always text)            |
| Embeddings     | Workers AI `bge-base-en-v1.5` (768-dim) → Vectorize      |
| Database       | Neon PostgreSQL + pgvector                               |
| Frontend       | Next.js on Cloudflare Workers                            |
| Billing        | Dodo Payments                                            |

## Monorepo layout

```text
apps/api/            FastAPI backend — services, routers, migrations, worker, tests
apps/web/            Next.js dashboard and marketing site
apps/sandbox/        Cloudflare Browser Run sandbox worker
packages/db/         Python `yomi-db` shared SQLAlchemy schema
packages/shared/     TypeScript contracts shared across apps
packages/ui/         TypeScript connector UI components

docs/adr/                Architecture decision records
docs/agents/             Agent workflows (issue tracker, triage, domain docs)
specs/                   Product specifications and connector references
```

## Local development

### Backend (Python)

```bash
cd apps/api
uv sync --dev
cp .env.example .env          # fill in Cloudflare credentials + secrets
uv run uvicorn yomi.run:app --reload --port 8080
```

Lint and test:

```bash
uv run ruff check .
uv run pytest -q
```

Migrations use Alembic against the same `DATABASE_URL` used by the container
(`apps/api/migrations`, schema owned by `packages/db`):

```bash
uv run alembic upgrade head
```

### Dashboard (Next.js)

Prerequisites: Node 22+ and uv.

```bash
npm install
cp .env.example .env
npm run dev --workspace @yomi/web    # http://localhost:3000
```

| App     | Command                          | URL                      |
| ------- | -------------------------------- | ------------------------ |
| Web | `npm run dev --workspace @yomi/web` | `http://localhost:3000` |
| API | `npm run python:dev` | `http://localhost:8080` |

## Configuration

[`.env.example`](./.env.example) documents every TS app variable;
[`apps/api/.env.example`](./apps/api/.env.example) is the Python
backend equivalent (see
[`apps/api/src/yomi/conf.py`](./apps/api/src/yomi/conf.py)). Secrets are
never committed — real values live in gitignored `.env*` files and Cloudflare
Worker secrets.

> `ENCRYPTION_KEY` must match across environments. A different key makes every
> stored connector token undecryptable. Rotate via `ENCRYPTION_KEY_FALLBACKS`.

## Plans & Credits

Billing is pure credits: a single credit balance is the only usage gate.
Connectors are unlimited on every plan.

| Plan    | Price  | Monthly credits         | Model         |
| ------- | ------ | ----------------------- | ------------- |
| Explore | $0/mo  | 100 (perpetual, renews) | qwen3.8-27b   |
| Pro     | $5/mo  | 300                     | qwen3.8-27b   |
| Max     | $40/mo | 750                     | qwen3.8-27b   |

Credit packs (any plan): 85 credits/$5, 250 credits/$15, 750 credits/$40.

There is one chokepoint — `apps/api/src/yomi/services/metering.py`
(`charge_usage`): check the active plan, check `balance >= cost`, record the
event, consume the credit. Every account is metered, including the operator's.

## Models

| Capability | Provider / default              |
| ---------- | ------------------------------- |
| Fast path  | Workers AI `qwen3.8-27b`        |
| Agent path | Workers AI `qwen3.8-27b`        |
| Embeddings | Workers AI `bge-base-en-v1.5`   |
| Speech     | Workers AI `whisper`            |

Speech-to-text handles incoming Telegram voice notes. Yomi always replies with
text, never synthesized voice.

## Connectors

- **First-class (hand-written tool sets):** Gmail, Google Calendar, Google
  Drive, Google Classroom, Google Tasks, Google Meet, GitHub, Notion, Slack,
  Linear.
- **Composio-backed (unified executor, approval-gated):** Docs, Sheets, Slides,
  Maps, Photos, Ads, Analytics, Search Console, Vision, HubSpot, Salesforce,
  Attio, Firecrawl, Discord, WhatsApp, LinkedIn, Outlook, Teams, OneDrive,
  Dropbox, Figma, YouTube, Zoom, Facebook, Instagram, Calendly, Trello, PostHog,
  Miro, Dynamics 365, SerpApi, Exa, Mem0, Cloudflare, Vercel, Supabase, Stripe,
  Neon, Zoho, Gumroad, Fireflies, Kaggle, Context7, Todoist, Reddit, Jira,
  Asana.

The full list lives in
[`specs/connectors/00-index.md`](specs/connectors/00-index.md).

## Commands

```bash
# TypeScript workspace (Turbo)
npm run lint
npm run typecheck
npm run test

# Python backend
cd apps/api && uv run ruff check . && uv run pytest -q
```

## Deployment

Both production apps are Cloudflare Workers deployed from GitHub Actions on
pushes to `main`; each workflow runs typecheck, tests, and the docs sync check
before it deploys.

| Component | Target              | Domain           | Workflow             |
| --------- | ------------------- | ---------------- | -------------------- |
| Backend   | Cloudflare Container | `api.getyomi.in` | `deploy-backend.yml` |
| Web       | Cloudflare Worker   | `getyomi.in`     | `deploy-landing.yml` |
| Database  | Neon PostgreSQL     | n/a              | `packages/db` schema + Alembic migrations in `apps/api/` |

Break-glass commands:

```bash
cd apps/api && npx wrangler deploy    # backend container
npm run deploy:production --workspace @yomi/web
```

## Privacy

- No silent recording. Voice notes are transcribed; replies are always text.
- Memory is user-owned. Export and delete always remain possible.
- OAuth tokens are encrypted at rest.
- Hook logs are PII-redacted.

## FAQ

**Is there a desktop or web chat app?** No. Telegram is the whole interface, by
design. The website is only a dashboard for linking accounts, schedules, memory,
and credits.

**What does it cost?** There is a free Explore plan (100 credits that renew) and
paid Pro/Max plans. See [Plans & Credits](#plans--credits).

**Which services does it work with?** Google Workspace (Gmail, Calendar, Drive,
Classroom, Tasks, Meet), GitHub, Slack, Notion, Linear, and dozens more through
Composio. See [Connectors](#connectors).

**Can it call me or record audio?** No. Incoming voice notes are transcribed to
text; Yomi always replies in text and never silently records anything.

**What happens to my data?** Memory is user-owned with export and delete always
available. OAuth tokens are encrypted at rest. See [Privacy](#privacy).

## Roadmap

Upstream priorities live in
[`specs/connectors/roadmap.md`](specs/connectors/roadmap.md). For what anyone
can pick up next, look for the `ready-for-agent` and `needs-triage` labels in
the [issues](https://github.com/arka6fx/yomi/issues).

## Community

- Chat with [**@yomi_assistant_bot**](https://t.me/yomi_assistant_bot).
- Report bugs and request features via
  [issues](https://github.com/arka6fx/yomi/issues).
- For vulnerabilities, follow [`SECURITY.md`](./SECURITY.md) — don't file a
  public issue.

## Contributing

Yomi is open source under the [MIT License](./LICENSE). We welcome contributors
— see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow, code style, and
test conventions. Bug reports and feature requests use the
[issue templates](./.github/ISSUE_TEMPLATE).
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) sets community standards, and
[`SECURITY.md`](./SECURITY.md) explains how to report a vulnerability.

## Docs & Specs

- [`AGENTS.md`](./AGENTS.md): terse operational summary agents load first.
- [`CONTEXT.md`](./CONTEXT.md): single-context domain overview.
- [`SOUL.md`](./SOUL.md): Yomi's voice contract — the reply-style the agent is
  held to.
- [`CHANGELOG.md`](./CHANGELOG.md): versioned release notes.
- [`docs/adr/`](docs/adr): architecture decision records.
- [`specs/`](specs/README.md): system specs and per-connector references. Start
  with [`specs/00-overview.md`](specs/00-overview.md).
- [`RUNBOOK.md`](./RUNBOOK.md): production deployment runbook.
