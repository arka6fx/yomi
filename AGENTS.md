# Yomi - AGENTS.md

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar, Drive,
Classroom, Tasks, Meet) and GitHub, Slack, Notion, Linear, and more. You talk to
Yomi on Telegram (text, voice, images); the web app is a management dashboard
(account linking, schedules, memory, billing), not a chat surface. Backend-first
for durable memory and connector agents.

---

## Design Principle

| Request type   | Architecture                        | Budget          |
| -------------- | ----------------------------------- | --------------- |
| Connector task | Python agent loop + connector tools | seconds-minutes |
| Telegram task  | Python gateway + memory/tools       | seconds-minutes |
| Computer use   | Browser Run REST API (via httpx)    | seconds-minutes |

Never switch models mid-turn; that loses prompt cache and causes tool-vocab mismatch.

---

## Footprint Ladder

Choose the highest, least-footprint rung that solves the problem:

1. **Extend existing code** — capability is a variation of something that already exists.
2. **CLI command + skill** — config/state expressible as shell commands.
3. **Service-gated tool** — structured params/returns, only appears when prerequisite configured.
4. **Plugin** — third-party/niche/user-specific capability.
5. **MCP server** — capability needs structured I/O but is not core-fundamental.
6. **New core tool** — only when fundamental, broadly useful, and unreachable via other means.

---

## Monorepo

```
         Telegram
     text / voice / images
               │
               ▼
   ┌──────────────────────────────────────────────┐
   │   THIN WORKER (apps/backend/containers/)     │
   │   TypeScript, Cloudflare Containers API      │
   │   Routes all traffic → Python container      │
   │   Forwards secrets via envVars               │
   └──────────────────┬───────────────────────────┘
                      │
                      ▼
   ┌──────────────────────────────────────────────┐
   │       PYTHON CONTAINER (apps/backend/)       │
   │   FastAPI + uvicorn on Cloudflare Containers │
   │                                              │
   │   auth, billing, LLM proxy, metering,       │
   │   agent loop, Telegram gateway,              │
   │   canonical memory, RAG, connectors          │
   │                                              │
   │   Cloudflare services via REST:              │
   │   • Browser Run → computer use              │
   │   • R2 → voice/image storage               │
   │   • Workers AI → embeddings (optional)      │
   └──────────┬────────────────────┬─────────────┘
              │                    │
              ▼                    ▼
         Connectors            Postgres
         first-class           Neon +
         + Composio            pgvector
              │
              └── Dashboard (apps/landing, Next.js)
                  marketing, auth, account linking,
                  credits, memory view
                  (all data via Python API)
```

```bash
# JS: install + run landing
npm install && npm run dev

# Python: install + run backend
cd apps/backend && uv sync && uv run uvicorn yomi.run:app --reload --port 8080

# Shortcut from root:
npm run python:dev
```

---

## Stack

- **LLM:** OpenAI SDK (Python) → `OPENAI_*` env vars
- **STT:** OpenAI `gpt-4o-mini-transcribe` — transcribes incoming voice notes; replies are always text
- **Backend:** Python FastAPI + uvicorn on **Cloudflare Containers** (TCP socket → asyncpg works)
- **Auth:** Better Auth (Google + GitHub OAuth) — session cookie validated by Python via JWT
- **Database:** asyncpg → Neon PostgreSQL + pgvector (SQLAlchemy 2 async, Alembic migrations)
- **Billing:** Dodo Payments
- **Computer use:** Cloudflare Browser Run REST API (scrape, screenshot, extract, CDP)
- **File storage:** Cloudflare R2 via S3-compatible API (aiobotocore)
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim) → pgvector; Workers AI optional

## Retired (do not reference)

- Legacy Hono/TypeScript backend — **deleted**. `apps/backend`, once that
  Worker's home, now hosts the canonical **Python FastAPI** backend.
- `packages/agent-core` — TypeScript AI SDK agent — **deleted**. Python
  `apps/backend/src/yomi/services/agent/` is canonical.
- `packages/db` (Drizzle/TS) — **deleted**. `packages/db` now ships the shared
  Python schema (`yomi-db`, SQLAlchemy 2 async) at `packages/db/src/yomi/db/`.

---

## Architecture

```
         Telegram
     text / voice / images
               │
               ▼
   ┌──────────────────────────────────────────────┐
   │   Thin Worker (apps/backend/containers/worker.ts) │
   │   Forwards all traffic + secrets to Python   │
   └──────────────────┬───────────────────────────┘
                      │ envVars (secrets)
                      ▼
   ┌──────────────────────────────────────────────┐
   │   Python Container (apps/backend/src/yomi/)  │
   │   FastAPI + uvicorn on :8080                 │
   │                                              │
   │ Routes:                                      │
   │   /api/gateway/telegram  ← Telegram webhook  │
   │   /api/agent/*           ← agent runs        │
   │   /api/integrations/*    ← OAuth connectors  │
   │   /api/memory/*          ← memory CRUD       │
   │   /api/rag/*             ← RAG indexing      │
   │   /api/billing/*         ← Dodo payments     │
   │   /api/schedules/*       ← cron schedules    │
   │   /api/auth/*            ← Better Auth JWT   │
   │   /health, /health/db    ← probes            │
   │                                              │
   │ Services:                                    │
   │   agent/loop.py          ← OpenAI tool loop  │
   │   agent/tools.py         ← tool registry    │
   │   browser.py             ← Browser Run REST  │
   │   memory/                ← memory engine     │
   │   rag/                   ← RAG pipeline      │
   │   metering.py            ← credit charging   │
   └──────────────────────────────────────────────┘
```

---

## Backend Status

`apps/backend/` is **canonical and sole backend**. The legacy TS Hono Worker has been retired and deleted.

### Python Coverage

| Area | Status | File |
|------|--------|------|
| Auth (JWT validation) | ✅ | `app/deps.py` |
| Billing / Dodo | ✅ | `app/routes/billing.py` |
| Memory | ✅ | `app/routes/memory.py`, `services/memory/` |
| RAG | ✅ | `app/routes/rag.py`, `services/rag/` |
| Schedules | ✅ | `app/routes/schedules.py` |
| Metering / Credits | ✅ | `services/metering.py`, `services/credit_ledger.py` |
| Privacy | ✅ | `app/routes/privacy.py`, `services/privacy/` |
| Profile | ✅ | `app/routes/profile.py` |
| Streaks | ✅ | `app/routes/streaks.py` |
| Referrals | ✅ | `app/routes/referrals.py` |
| Status | ✅ | `app/routes/status.py` |
| **Telegram gateway** | ✅ | `gateway/telegram.py` |
| **Agent loop** | ✅ | `services/agent/loop.py` |
| **Browser / computer use** | ✅ | `services/browser.py` |
| **OAuth integrations** | ✅ | `app/routes/integrations.py` |
| **R2 file storage** | 🔧 stub | `services/storage.py` (needs R2 secrets) |
| Connectors (Gmail, etc.) | 🚧 in progress | |
| MCP / custom-MCP | 🔧 stub | `app/routes/custom_mcp.py` |

---

## Database

Schema: `packages/db/src/yomi/db/` (shipped as the `yomi-db` distribution; imports
as `yomi.db.*` via the PEP 420 namespace). Better Auth owns `user / session / account / verification`
(session cookies validated by Python via JWT; OAuth handler still hits `api.getyomi.in` until cutover).

Driver: `asyncpg` over TCP to Neon (this is why a Container, not a Worker, is required —
asyncpg needs a real TCP socket). SQLAlchemy 2 async + Alembic migrations in `apps/backend/migrations`.
The Drizzle schema (`packages/db`) is retired, but the SQLAlchemy models mirror it one-for-one.

---

## Plans & Credits

| Plan    | Price  | Monthly credits         | Model        |
| ------- | ------ | ----------------------- | ------------ |
| Explore | $0/mo  | 100 (perpetual, renews) | gpt-5.4-mini |
| Pro     | $5/mo  | 300                     | gpt-5.4-mini |
| Max     | $40/mo | 750                     | gpt-5.5      |

Credit costs: fast chat 1, image analyze 1, voice 2/min, bot message 3, agent run 3 base
(+1 per Composio tool call). Single chokepoint: `services/metering.py → charge_usage()`.

---

## Harness

`harness = system prompt + tools + connectors + memory + hooks`

`SOUL.md` (repo root) is always part of the system prompt.

**Agent path:** Python agent loop (`services/agent/loop.py`) with full tool set:

- Core: web search, browser (scrape/screenshot/extract/crawl), memory r/w, cron
- Connectors: loaded from connector registry
  - First-class (Python tool sets): Gmail, Google Calendar, Google Drive, GitHub, Slack, Notion, Linear
  - Composio-backed: Google Docs, Sheets, Slides, Maps, Photos, HubSpot, Salesforce, Discord,
    WhatsApp, LinkedIn, Outlook, Teams, OneDrive, Dropbox, Figma, YouTube, Zoom, Stripe, etc.

---

## Privacy

- Encrypted memory sync; user-owned export/delete.
- OAuth tokens are encrypted at rest (`services/privacy/`, `crypto.py`).
- Hook logs must be PII-redacted.

---

## Models

```
Fast path:  gpt-5.4-mini (Explore, Pro)
Agent path: gpt-5.5      (Max)
Embeddings: text-embedding-3-small (OpenAI, 1536-dim)
Speech:     gpt-4o-mini-transcribe (STT only; replies are always text)
Browser AI: Workers AI @cf/baai/bge-base-en-v1.5 (optional free embeddings)
```

---

## Deploys

**Python backend** deploys itself on push to `main` when `apps/backend/**` or
`packages/db/**` changes (`.github/workflows/deploy-backend.yml`). Triggers `uv pytest`,
then `wrangler deploy` which builds the Docker image and pushes to Cloudflare Containers.

**Dashboard** deploys itself on push to `main` when `apps/landing/**` changes
(`.github/workflows/deploy-landing.yml`). Uses npm + `next build` + `wrangler deploy`.

Secrets live as Worker Secrets (`wrangler secret put`), forwarded to the container
via `envVars` in `apps/backend/containers/worker.ts`. See `apps/backend/README.md` for the full list.

Manual deploy (break-glass):
```bash
# Python container
cd apps/backend && npx wrangler deploy

# Dashboard
cd apps/landing && npm run deploy:production
```

---

## Code Style & Cleanup

**Python:** ruff (E, F, I, UP, B, SIM), 100 char line length, Python 3.11+, async/await everywhere.
**TypeScript (landing only):** ESLint + Prettier. No `as any`, no unused imports.
Conventional commits: `feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `chore:`, `docs:`.
Lowercase, no full stop, max 72 chars.

Before pushing: `npm run python:test && npm run python:lint` or `cd apps/backend && uv run pytest -q`.

---

## Agent Skills

### Issue tracker
Issues live in GitHub Issues on `arka6fx/yomi` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels
Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
See `docs/agents/triage-labels.md`.

### Domain docs
Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
