# Yomi

Yomi is a personal AI assistant on Telegram. Send it a text, a voice note, or a
photo, and it reads and drafts email, summarizes threads, schedules meetings,
searches your files, files tasks, and acts across the tools you already use.

There is no desktop app. Telegram is the whole interface. The website is a
dashboard for linking services, setting schedules, reviewing memory, and
checking credits.

Yomi connects Google Workspace (Gmail, Calendar, Drive, Classroom, Tasks, Meet),
GitHub, Slack, Notion, Linear, and dozens more.

## Contents

- [How it works](#how-it-works)
- [Stack](#stack)
- [Monorepo Layout](#monorepo-layout)
- [Local Development](#local-development)
- [Configuration](#configuration)
- [Plans & Credits](#plans--credits)
- [Models](#models)
- [Connectors](#connectors)
- [Commands](#commands)
- [Testing](#testing)
- [Deployment](#deployment)
- [Privacy](#privacy)
- [Docs & Specs](#docs--specs)

## How it works

Yomi is backend-first. Durable memory, connector credentials, and the agent loop
all live in the cloud backend, so the client stays thin. Telegram sends your
message to the backend; the backend thinks, uses tools, and replies.

```text
                    Telegram
                       |
             CLOUD BACKEND  (Hono)
   auth, billing, LLM proxy, metering, agent loop, canonical memory
                       |
        +--------------+--------------+
        |              |
   Connectors      Postgres
   (first-class    (Neon,
    + Composio)     pgvector)
                       |
             LANDING / DASHBOARD  (Next.js)
    marketing, auth, account linking, credits, memory
```

Every request is one of two shapes. Yomi never switches models mid-turn, since
that would drop the prompt cache and mismatch the tool vocabulary.

| Request type   | Path                                | Budget             |
| -------------- | ----------------------------------- | ------------------ |
| Connector task | Agent loop + connector tools        | seconds to minutes |
| Telegram task  | Backend agent + memory/tool harness | seconds to minutes |

The harness is the system prompt, plus tools, connectors, memory, and hooks:

- **Core tools:** filesystem r/w, sandboxed bash, web search/fetch, cron,
  messaging, memory.
- **Connectors:** loaded from `ConnectorRegistry` (first-class, hand-written
  tool sets) plus a Composio-backed unified executor for long-tail services.
- **Hooks:** `PreToolUse` (block dangerous), `PostToolUse` (log, trim tokens),
  `Stop` (flush scratchpad), `SessionEnd` (compact memory).
- **Loop guard:** an `AGENT_MAX_STEPS` cap with a backend grace-call wrap-up.

Yomi also keeps a small notepad in `~/.yomi/`:

```text
yomi.md        ALWAYS preloaded: identity, prefs, standing instructions
memory.md      Long-term memory (curated, compacted)
projects/<p>/  context.md, scratchpad.md
sessions/      YYYY-MM-DD-topic.md summaries
```

`yomi.md` is always preloaded; everything else is loaded just in time. Backend
memory stays canonical for durable facts, document provenance, Telegram, and
connector agents.

## Stack

| Layer          | Choice                                                          |
| -------------- | --------------------------------------------------------------- |
| LLM            | Vercel AI SDK (`ai`) → OpenAI (`api.openai.com`)                |
| Speech-to-text | OpenAI `gpt-4o-mini-transcribe` (replies are always text)       |
| Backend        | Hono on Cloudflare Workers                                      |
| Frontend       | Next.js on Cloudflare Workers                                   |
| Database       | PostgreSQL (Neon) via Drizzle ORM + `@neondatabase/serverless`  |
| Auth           | Better Auth (Google + GitHub OAuth)                             |
| Billing        | Dodo Payments                                                   |
| Orchestration  | AI SDK agent loop with connector tools + backend Telegram agent |

## Monorepo Layout

```text
apps/backend/            Hono on Workers: auth, billing, LLM proxy, metering, Telegram, memory
apps/landing/            Next.js on Workers: marketing, dashboard, account linking
packages/agent-core/     ConnectorDef, ConnectorRegistry, agent tools
packages/db/             Drizzle schema + Postgres client (Neon HTTP driver)
packages/shared/         TypeScript contracts shared across apps
packages/ui-connectors/  Connector UI components

docs/adr/                Architecture decision records
docs/agents/             Agent workflows (issue tracker, triage, domain docs)
specs/                   Product specifications and connector references
```

## Local Development

Prerequisites: Bun 1.3.x, Node 20+, a PostgreSQL database (local Postgres or
Neon), and an OpenAI API key.

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi
bun install
cp .env.example .env
bun run dev
```

Dev targets:

| App     | Command                          | URL                     |
| ------- | -------------------------------- | ----------------------- |
| Landing | `cd apps/landing && bun run dev` | `http://localhost:3000` |
| Backend | `cd apps/backend && bun run dev` | `http://localhost:3001` |

## Configuration

[`.env.example`](./.env.example) is the source of truth for every variable:
database, Better Auth, Google/GitHub OAuth, the OpenAI endpoint, encryption
keys, and Dodo Payments. Secrets are never committed. Real values live in
`.env.production` (gitignored) and in Worker secrets.

Production uses split hostnames:

```bash
BETTER_AUTH_URL=https://getyomi.in
BETTER_AUTH_BASE_URL=https://api.getyomi.in
BACKEND_URL=https://api.getyomi.in
NEXT_PUBLIC_APP_URL=https://getyomi.in
YOMI_BACKEND_URL=https://api.getyomi.in
CORS_ORIGIN=https://getyomi.in
```

> `ENCRYPTION_KEY` must match across environments. A different key makes every
> stored connector token undecryptable. Rotate via `ENCRYPTION_KEY_FALLBACKS`.

## Plans & Credits

Billing is pure credits: a single credit balance is the only usage gate.
Connectors are unlimited on every plan.

| Plan    | Price  | Monthly credits         | Model        |
| ------- | ------ | ----------------------- | ------------ |
| Explore | $0/mo  | 100 (perpetual, renews) | gpt-5.4-mini |
| Pro     | $5/mo  | 300                     | gpt-5.4-mini |
| Max     | $40/mo | 750                     | gpt-5.5      |

Credit packs (any plan): 85 credits/$5, 250 credits/$15, 750 credits/$40.

There is one chokepoint: `apps/backend/src/services/metering.ts` →
`chargeUsage()`, which checks the active plan, checks `balance >= cost`, then
records the event and consumes the credit. Every account is metered, including
the operator's. The plan source of truth lives in
`packages/shared/src/plans.ts`; webhooks live in
`apps/backend/src/routes/billing.ts`.

## Models

| Capability | Provider / default              |
| ---------- | ------------------------------- |
| Fast path  | OpenAI `gpt-5.4-mini`           |
| Agent path | OpenAI `gpt-5.5`                |
| Embeddings | OpenAI `text-embedding-3-small` |
| Speech     | OpenAI `gpt-4o-mini-transcribe` |

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
bun run lint
bun run typecheck
bun run test
bun run build:ci
bun run build
```

Database commands live in `packages/db`:

```bash
cd packages/db
bun run db:generate
bun run db:migrate
bun run db:studio
```

## Testing

Tests are package-local and sit next to the code they exercise
(`apps/backend/src/routes/usage.test.ts`, not a root `tests/` folder). Turborepo
schedules and caches by package, so colocated tests let
`turbo run test --filter ...` and `--affected` run only the packages that
changed.

## Deployment

Both apps deploy from GitHub Actions on pushes to `main`. Each workflow runs
typecheck, tests, and the docs sync check before it deploys, so a red build
never ships.

| Component | Target                     | Domain           | Workflow                 |
| --------- | -------------------------- | ---------------- | ------------------------ |
| Backend   | Cloudflare Worker          | `api.getyomi.in` | `deploy-backend.yml`     |
| Landing   | Cloudflare Worker          | `getyomi.in`     | `deploy-landing.yml`     |
| Database  | Neon PostgreSQL (pgvector) | n/a              | `packages/db` migrations |

Custom domains are bound in the Cloudflare dashboard. The deploy token is an
Account API token, which cannot manage the zone-scoped Workers routes API, so
the domains are not declared in `wrangler.jsonc`.

Backend break-glass when the runner is unavailable:

```bash
cd apps/backend && bun run deploy:production
```

Frontend break-glass:

```bash
cd apps/landing && bun run deploy:production
```

## Privacy

- No silent recording.
- Memory is user-owned. Export and delete always remain possible.
- OAuth tokens are encrypted at rest.
- Hook logs are PII-redacted.

## Docs & Specs

- [`AGENTS.md`](./AGENTS.md): terse operational summary agents load first.
- [`CONTEXT.md`](./CONTEXT.md): single-context domain overview.
- [`docs/adr/`](docs/adr): architecture decision records.
- [`specs/`](specs/README.md): system specs and per-connector references. Start
  with [`specs/00-overview.md`](specs/00-overview.md).
- [`SETUP_GUIDE.md`](./SETUP_GUIDE.md): environment runbook.
