<p align="center">
  <img src="./assets/yomi-mark.png" alt="Yomi" width="96" height="96" />
</p>

<h1 align="center">Yomi</h1>

<p align="center">
  A personal AI assistant that lives in Telegram.
</p>

<p align="center">
  <a href="https://getyomi.in">Website</a> ·
  <a href="https://t.me/yomi_assistant_bot">Telegram bot</a> ·
  <a href="https://getyomi.in/dashboard">Dashboard</a> ·
  <a href="https://getyomi.in/docs">User docs</a> ·
  <a href="./LICENSE">MIT license</a>
</p>

---

Send Yomi a text, a voice note, or a photo on Telegram. It reads your inbox,
checks your calendar, searches the web, drives a real browser, and works across
Gmail, Google Calendar, Drive, GitHub, Slack, Notion, Linear, and dozens more
services. It always asks before it sends, books, pays, or deletes anything.

The web app at [getyomi.in](https://getyomi.in) is the management dashboard:
connect services, review approvals, manage memory and routines, and handle
billing. Conversation happens in Telegram.

## Features

| Area               | What it does                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Chat**           | Text, voice notes (transcribed), and images on Telegram. Replies are text.                                        |
| **Connectors**     | First-class Gmail, Calendar, and Drive tools, plus Composio for GitHub, Slack, Notion, Linear, and the long tail. |
| **Approvals**      | Sensitive actions become a preview with Approve / Reject buttons in Telegram and on the dashboard.                |
| **Memory**         | User-owned long-term memory, exportable and deletable, with per-feature consent.                                  |
| **RAG**            | Index text, URLs, documents, and Drive folders for retrieval.                                                     |
| **Routines**       | Scheduled briefings, digests, and checks that report back on Telegram.                                            |
| **Skills**         | A gallery of ready-made routines and chat skills you can add in one tap.                                          |
| **Computer**       | A private cloud desktop with Chrome that the agent can drive and you can watch live.                              |
| **Vault**          | Stored logins, cards, and addresses the agent can use without ever seeing the raw secret.                         |
| **Email address**  | Every user gets a Yomi address for sign-ups, bookings, and receipts.                                              |
| **Trusted people** | Let your Yomi message a friend's Yomi on your behalf.                                                             |
| **Characters**     | Optional personas that change who answers, never what Yomi is allowed to do.                                      |

## Architecture

```text
 Telegram ──► api.getyomi.in ─────────────────────────────────────────────┐
              Cloudflare Worker (apps/api/containers/worker.ts)           │
              routes HTTP, cron ticks, and inbound email to ──►           │
                                                                          ▼
                                       FastAPI container (apps/api/src/yomi)
                                       agent loop · gateway · auth · billing
                                         │            │               │
              storage gateway Worker ◄───┘            │               └──► computer Worker
              D1 · Vectorize · R2                     │                    (apps/sandbox)
                                                      ▼
                                          Workers AI · Composio · Google APIs

 getyomi.in ──► Next.js dashboard (apps/web) ──► /api/* ──► FastAPI container
```

- **One backend.** The Python FastAPI app owns authentication, billing and
  metering, the Telegram gateway, the agent loop, connectors, memory, and RAG.
  The dashboard never touches storage directly.
- **Cloudflare-native storage.** The container reaches D1 (relational data),
  Vectorize (embeddings), and R2 (media) through a small storage gateway Worker
  that holds the bindings.
- **Workers AI only.** Chat, agent, search, and vision run on
  `@cf/zai-org/glm-5.3-flash`; speech-to-text on `whisper-large-v3-turbo`;
  embeddings on `bge-base-en-v1.5`.

Read [`docs/architecture.md`](./docs/architecture.md) for the full picture.

## Tech stack

| Layer    | Technology                                                             |
| -------- | ---------------------------------------------------------------------- |
| Backend  | Python 3.11, FastAPI, uvicorn, httpx                                   |
| Runtime  | Cloudflare Containers and Workers                                      |
| Storage  | Cloudflare D1, Vectorize, R2                                           |
| Models   | Cloudflare Workers AI                                                  |
| Web      | Next.js, React, Tailwind CSS                                           |
| Payments | Dodo Payments                                                          |
| Tooling  | uv, ruff, pytest · npm workspaces, Turborepo, ESLint, Prettier, Vitest |

## Repository layout

```text
yomi/
├── apps/
│   ├── api/          FastAPI backend, Cloudflare Workers, D1 migrations, tests
│   ├── web/          Next.js marketing site and dashboard
│   └── sandbox/      Computer-use desktop (Cloudflare Sandbox + Chrome)
├── packages/
│   ├── db/           Python SQLAlchemy models (legacy Postgres path)
│   ├── shared/       TypeScript contracts shared across apps
│   ├── ui/           Connector catalog and dashboard UI components
│   ├── eslint-config/
│   └── typescript-config/
├── docs/             Architecture, runbook, ADRs, and product specs
├── assets/           Brand marks and favicons
├── scripts/          Repository tooling (docs sync check)
├── AGENTS.md         Working instructions for coding agents
├── CONTEXT.md        Domain glossary
└── SOUL.md           Yomi's personality, part of every system prompt
```

## Getting started

**Prerequisites:** Node.js 22+, [`uv`](https://docs.astral.sh/uv/), and a
Cloudflare account for Workers AI and the storage gateway.

```bash
git clone https://github.com/arka6fx/yomi.git
cd yomi
npm install

# Backend — http://localhost:8080
cp apps/api/.env.example apps/api/.env   # fill in the Cloudflare values
cp apps/web/.env.example apps/web/.env.local
npm run python:dev

# Dashboard — http://localhost:3000 (in a second terminal)
npm run dev --workspace @yomi/web
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full development workflow.

## Checks

```bash
# Python backend
npm run python:lint
npm run python:test

# TypeScript workspace
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run docs:check
```

CI runs all of these on every pull request.

## Deployment

Pushes to `main` deploy automatically through GitHub Actions:

| Path changed                    | Deploys                              | Workflow              |
| ------------------------------- | ------------------------------------ | --------------------- |
| `apps/api/**`, `packages/db/**` | Backend container → `api.getyomi.in` | `deploy-backend.yml`  |
| `apps/web/**`                   | Web app → `getyomi.in`               | `deploy-landing.yml`  |
| `apps/sandbox/**`               | Computer gateway                     | `deploy-computer.yml` |

D1 migrations and the storage gateway are deployed by hand. See the
[production runbook](./docs/runbook.md).

## Plans

| Plan    | Price       |     Credits |
| ------- | ----------- | ----------: |
| Explore | Free        | 100 / month |
| Pro     | $5 / month  | 300 / month |
| Max     | $40 / month | 750 / month |

Credit packs are available on every plan. Current details are on the
[pricing page](https://getyomi.in/pricing).

## Documentation

| Document                                         | Contents                             |
| ------------------------------------------------ | ------------------------------------ |
| [`docs/`](./docs/README.md)                      | Index of all project documentation   |
| [`docs/architecture.md`](./docs/architecture.md) | System design and request flow       |
| [`docs/runbook.md`](./docs/runbook.md)           | Production operations                |
| [`docs/specs/`](./docs/specs/README.md)          | Product and connector specifications |
| [`docs/adr/`](./docs/adr/)                       | Architecture decision records        |
| [`apps/api/README.md`](./apps/api/README.md)     | Backend development and deployment   |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md)           | Contribution workflow                |
| [`SECURITY.md`](./SECURITY.md)                   | Reporting vulnerabilities            |
| [`CHANGELOG.md`](./CHANGELOG.md)                 | Release history                      |

## Contributing

Issues and feature requests go to
[GitHub Issues](https://github.com/arka6fx/yomi/issues). Before opening a pull
request, read [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please report security
issues privately as described in [`SECURITY.md`](./SECURITY.md).

## License

[MIT](./LICENSE) © Arka Garai and contributors
