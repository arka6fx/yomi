# Yomi - AGENTS.md

Working instructions for coding agents and contributors. For the project
overview see [`README.md`](./README.md); for the system design see
[`docs/architecture.md`](./docs/architecture.md).

Yomi is a personal AI assistant. Users talk to it on **Telegram** (text, voice,
images). The web app at `getyomi.in` is a **management dashboard** (account
linking, approvals, routines, memory, billing). Its conversation page can text
Yomi too, in the same thread as Telegram.

---

## Design principles

| Request type     | Path                                         | Budget          |
| ---------------- | -------------------------------------------- | --------------- |
| Telegram message | Python gateway → background agent run        | seconds–minutes |
| Connector task   | Agent loop + connector tools                 | seconds–minutes |
| Computer use     | Browser Run REST API, or the sandbox desktop | seconds–minutes |

- **Never switch models mid-turn.** It loses the prompt cache and breaks
  tool-vocabulary consistency.
- **Ask before irreversible actions.** Sending, booking, paying, and deleting go
  through a pending action the user approves.
- **The backend owns all data.** The web app never reads storage directly.

## Footprint ladder

Pick the highest rung (smallest footprint) that solves the problem:

1. **Extend existing code**: the capability is a variation of something that
   exists.
2. **CLI command + skill**: config or state expressible as shell commands.
3. **Service-gated tool**: structured params and returns; only appears once its
   prerequisite is configured.
4. **Plugin**: third-party, niche, or user-specific.
5. **MCP server**: needs structured I/O but is not core.
6. **New core tool**: only when fundamental, broadly useful, and unreachable
   otherwise.

---

## Repository map

```text
apps/api/          FastAPI backend (canonical), Workers, D1 migrations, tests
  src/yomi/app/        routes (/api/*), deps, auth
  src/yomi/gateway/    Telegram webhook
  src/yomi/services/   agent loop, memory, RAG, metering, *_d1 data access
  src/yomi/connectors/ Gmail, Calendar, Drive, Composio bridge
  containers/          backend Worker (worker.ts) + storage gateway (storage.ts)
  migrations-d1/       D1 schema (numbered SQL)
apps/web/          Next.js marketing site + dashboard (see apps/web/CLAUDE.md)
apps/sandbox/      computer-use desktop (Cloudflare Sandbox + Chrome)
packages/db/       SQLAlchemy models for the legacy Postgres path
packages/shared/   TypeScript contracts shared across apps
packages/ui/       connector catalog + dashboard components
docs/              architecture, runbook, specs, ADRs
SOUL.md            personality notes (the live prompt is DEFAULT_AGENT_SOUL in shared/text.py)
CONTEXT.md         domain glossary
```

```bash
npm install && npm run python:dev          # backend on :8080
npm run dev --workspace @yomi/web   # dashboard on :3000
```

---

## Stack

- **Backend:** Python 3.11 FastAPI + uvicorn in a **Cloudflare Container**,
  behind the thin Worker `apps/api/containers/worker.ts` (HTTP, cron, inbound
  email).
- **Storage:** Cloudflare **D1** (relational), **Vectorize** (768-dim
  embeddings), **R2** (media), reached through the `yomi-storage` gateway
  Worker. `STORAGE_BACKEND=d1` is the default; Postgres (`packages/db`, Alembic)
  is a legacy fallback that production does not use.
- **LLM:** Workers AI via its OpenAI-compatible endpoint:
  `@cf/zai-org/glm-5.3-flash` for chat, agent, search, and vision (reasoning low
  for chat, high for agent runs). No OpenAI dependency.
- **Speech:** `@cf/openai/whisper-large-v3-turbo`, used to transcribe incoming
  voice notes. Replies are always text.
- **Embeddings:** `@cf/baai/bge-base-en-v1.5` (768-dim) → Vectorize.
- **Computer use:** Cloudflare Browser Run REST API, plus a per-user sandbox
  desktop (`apps/sandbox`).
- **Auth:** Telegram sign-in (one-time code approved in the bot), Google, and
  GitHub. Session cookies are Better Auth–compatible and validated by Python.
- **Billing:** Dodo Payments.
- **Web:** Next.js on Cloudflare Workers.

## Retired (do not reference or reintroduce)

- The TypeScript Hono backend and `packages/agent-core`. Python is the only
  backend.
- The Drizzle/TypeScript schema. `packages/db` now holds only the Python models.
- Neon Postgres in production. Data lives in D1.
- OpenAI models. Everything runs on Workers AI.
- The desktop client
  ([ADR 0002](./docs/adr/0002-retire-desktop-telegram-only.md)).

---

## Harness

`harness = system prompt + tools + connectors + memory + hooks`

The personality prompt is `DEFAULT_AGENT_SOUL` in
`apps/api/src/yomi/shared/text.py`. `SOUL.md` holds longer-form personality
notes and is not loaded at runtime.

Agent loop: `apps/api/src/yomi/services/agent/loop.py`, with tools registered in
`services/agent/tools.py`:

- **Core:** web search, browser (scrape, screenshot, extract, crawl), computer,
  memory read/write, routines, vault, trusted people, email.
- **Connectors:**
  - First-class Python tool sets: Gmail, Google Calendar, Google Drive.
  - Composio-backed: GitHub, Slack, Notion, Linear, Google Docs, Sheets, Slides,
    Maps, Photos, HubSpot, Salesforce, Discord, LinkedIn, Outlook, Teams,
    OneDrive, Dropbox, Figma, YouTube, Zoom, Stripe, and more.

## Plans

| Plan | Price    | What changes                                                   |
| ---- | -------- | -------------------------------------------------------------- |
| Free | $0       | Unlimited chat and every feature; 3 active routines            |
| Pro  | $5/month | Unlimited routines; the smarter engine (reasoning effort high) |

There are no credits. `services/billing_d1.py → charge_usage()` is still the one
chokepoint every billable action calls, but it only logs a `usage_events` row
for cost visibility; it never debits or blocks. The routine cap is
`SCHEDULE_LIMITS` in `services/schedule_parser.py`. The retired Max plan maps to
Pro. Plan definitions: `apps/api/src/yomi/shared/plans.py` and
`apps/web/src/lib/plans.ts`.

## Privacy

- User-owned memory with export and delete.
- OAuth tokens and vault secrets are encrypted at rest (`crypto.py`,
  `services/privacy/`).
- Logs and hook output must be PII-redacted. LLM telemetry records metadata,
  never content.

---

## Deploys

| Push to `main` touching         | Workflow              | Target                   |
| ------------------------------- | --------------------- | ------------------------ |
| `apps/api/**`, `packages/db/**` | `deploy-backend.yml`  | `yomi-backend` container |
| `apps/web/**`                   | `deploy-landing.yml`  | `yomi-landing` Worker    |
| `apps/sandbox/**`               | `deploy-computer.yml` | computer gateway         |

**Not automatic:** D1 migrations and the storage gateway. Apply migrations
before deploying code that needs them. Secrets are Worker Secrets forwarded to
the container through `envVars` in `worker.ts`. All of this is in
[`docs/runbook.md`](./docs/runbook.md).

## Code style

- **Python:** ruff (`E, F, I, UP, B, SIM`), 100-character lines, Python 3.11+,
  async/await throughout.
- **TypeScript:** ESLint + Prettier. No `as any`, no unused imports.
- **Commits:** `type(scope): summary`, like
  `fix(api): stop routines failing with 401`. Types: `feat`, `fix`, `docs`,
  `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Scope
  optional (`api`, `web`, `docs`, …). Lowercase, no trailing period, **60
  characters at most**. Put detail in the body, not the subject.
  `.githooks/commit-msg` (installed by `npm install`) and the PR title check
  enforce it; PRs squash-merge under their title.

Before pushing:

```bash
npm run python:lint && npm run python:test
npm run lint && npm run typecheck && npm run test && npm run docs:check
```

## Docs: sources of truth

Some facts live in code and are repeated in docs. When they change, update the
docs in the same commit. `npm run docs:check` (`scripts/check-docs-sync.ts`)
enforces the ones below in CI.

| Fact                               | Source of truth                                | Repeated in                                    |
| ---------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Connector catalog                  | `packages/ui/src/catalog.ts`                   | `docs/specs/connectors/00-index.md`, this file |
| D1 schema                          | `apps/api/migrations-d1/`                      | `docs/specs/11-database.md`                    |
| Secrets forwarded to the container | `apps/api/containers/worker.ts`                | `docs/runbook.md`                              |
| Plans and limits                   | `shared/plans.py`, `apps/web/src/lib/plans.ts` | `README.md`, `docs/specs/13-pricing.md`        |

---

## Claude Code

- `CLAUDE.md` imports this file. `apps/api/CLAUDE.md` and `apps/web/CLAUDE.md`
  add area-specific rules and load when you work in those folders.
- `/check` runs every CI check and fixes failures. `/new-migration <what>` adds
  a D1 migration with tests.
- In Claude Code on the web, `.claude/hooks/session-start.sh` installs npm and
  uv dependencies before the session starts.
- `.claude/settings.json` asks before deploys, `wrangler secret`, and remote D1
  migrations, and blocks reading real `.env` files.

## Agent skills

- **Issue tracker:** GitHub Issues on `arka6fx/yomi`. See
  [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md).
- **Triage labels:** `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`. See
  [`docs/agents/triage-labels.md`](./docs/agents/triage-labels.md).
- **Domain docs:** one [`CONTEXT.md`](./CONTEXT.md) and
  [`docs/adr/`](./docs/adr/) at the repo root. See
  [`docs/agents/domain.md`](./docs/agents/domain.md).
