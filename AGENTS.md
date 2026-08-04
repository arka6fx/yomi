# Yomi - AGENTS.md

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar, Drive,
Classroom, Tasks, Meet) and GitHub, Slack, Notion, Linear, and more. You talk to
Yomi on Telegram (text, voice, images); the web app is a management dashboard
(account linking, schedules, memory, billing) — not a chat surface.
Backend-first for durable memory and connector agents.

---

## Design Principle

| Request type   | Architecture                 | Budget          |
| -------------- | ---------------------------- | --------------- |
| Connector task | Agent loop + connector tools | seconds-minutes |
| Telegram task  | Backend agent + memory/tools | seconds-minutes |

Never switch models mid-turn; that loses prompt cache and causes tool-vocab
mismatch.

---

## Footprint Ladder

Choose the highest, least-footprint rung that solves the problem:

1. **Extend existing code** - capability is a variation of something that
   already exists.
2. **CLI command + skill** - config/state expressible as shell commands.
3. **Service-gated tool** - structured params/returns, only appears when
   prerequisite configured.
4. **Plugin** - third-party/niche/user-specific capability.
5. **MCP server** - capability needs structured I/O but is not core-fundamental.
6. **New core tool** - only when fundamental, broadly useful, and unreachable
   via other means.

---

## Monorepo

```text
apps/backend/        Hono/Bun - auth, billing, LLM proxy, metering
apps/landing/        Next.js  - marketing, dashboard, account linking
packages/agent-core/ ConnectorDef, ConnectorRegistry, agent tools
packages/db/         Drizzle schema + PostgreSQL (AWS RDS)
packages/shared/     TypeScript contracts
packages/ui-connectors/ Connector UI components
```

```bash
bun install && bun run dev
```

---

## Stack

- **LLM:** Vercel AI SDK (`ai`) -> OpenAI (standard `OPENAI_*` env vars)
- **STT:** OpenAI (`gpt-4o-mini-transcribe`) — transcribes incoming voice notes;
  replies are always text
- **Backend:** Hono on Bun (EC2 + Docker + Caddy), Better Auth (Google + GitHub
  OAuth), Drizzle + PostgreSQL (AWS RDS)
- **Billing:** Dodo Payments
- **Agent orchestration:** AI SDK agent loop with connector tools; backend agent
  for Telegram

---

## Architecture

```text
CLOUD BACKEND  (Hono/Bun)
  Better Auth - Dodo webhooks - LLM proxy - usage metering - Telegram - canonical memory

LANDING/DASHBOARD  (Next.js)
  Marketing - auth pages - dashboard - account linking
```

---

## Harness

`harness = system prompt + tools + connectors + memory + hooks`

**Agent path:** AI SDK loop + full tool set:

- Core: filesystem r/w, bash (sandboxed), web search/fetch, cron, messaging,
  memory
- Connectors: loaded from `ConnectorRegistry`
  - First-class (hand-written tool sets): Gmail, Google Calendar, Google Drive,
    Google Classroom, Google Tasks, Google Meet, GitHub, Notion, Slack, Linear,
    Swiggy
  - Composio-backed (unified executor, approval-gated): Google Docs, Google
    Sheets, Google Slides, Google Maps, Google Photos, Google Ads, Google
    Analytics, Google Search Console, Google Cloud Vision, HubSpot, Salesforce,
    Attio, Firecrawl, Discord, WhatsApp, LinkedIn, Outlook, Microsoft Teams,
    OneDrive, Dropbox, Figma, YouTube, Zoom, Facebook, Instagram, Calendly,
    Trello, PostHog, Miro, Dynamics 365, SerpApi, Exa, Mem0, Cloudflare, Vercel,
    Supabase, Stripe, Neon, Zoho CRM, Zoho Invoice, Gumroad, Fireflies, Kaggle,
    Context7, Todoist, Reddit, Jira, Asana - full list in
    `specs/connectors/00-index.md`

**Hooks:** `PreToolUse` (block dangerous), `PostToolUse` (log, trim tokens),
`Stop` (flush scratchpad), `SessionEnd` (compact memory.md)

**Loop guards:** `AGENT_MAX_STEPS` cap plus backend grace-call wrap-up when the
step cap is hit without a final answer.

---

## Notepad (`~/.yomi/`)

```text
yomi.md          ALWAYS preloaded - user identity, prefs, standing instructions
memory.md        Long-term memory (curated, compacted)
projects/<proj>/ context.md, scratchpad.md
sessions/        YYYY-MM-DD-topic.md summaries
```

Always preload `yomi.md`; JIT-load everything else. Backend memory is canonical
for durable facts, document provenance, Telegram, and connector agents.

---

## Database

Schema: `packages/db/src/schema.ts`. Better Auth owns
`user / session / account / verification`; the `user` table is extended in place
with the plan/subscription/trial columns. `usage_events` is append-only.
`mcp_connections.oauth_tokens` and `hook_logs` are encrypted / PII-redacted
respectively.

`apps/landing` deploys as a Cloudflare Worker and has its own I/O rules - see
`apps/landing/CLAUDE.md`.

---

## Plans & Credits

Billing is pure credits - a single credit balance is the only usage gate.
Per-feature monthly caps were removed; connectors are unlimited on every plan.

| Plan    | Price  | Monthly credits         | Model        |
| ------- | ------ | ----------------------- | ------------ |
| Explore | $0/mo  | 100 (perpetual, renews) | gpt-5.4-mini |
| Pro     | $5/mo  | 300                     | gpt-5.4-mini |
| Max     | $40/mo | 750                     | gpt-5.5      |

Credit packs (shared currency, any plan): 85 credits/$5, 250 credits/$15, 750
credits/$40 - priced against worst-case gpt-5.5 cost since Max users can buy
them too.

Explore/Pro route through the cheap model on purpose - that's the margin lever,
not the credit count alone. Credit costs: fast chat 1, image analyze 1, voice
2/min, bot message 3, agent run 3 base (+1 per Composio tool call in that turn,
charged separately). Tune from `ai_usage_events` telemetry; real API cost is
recorded in `totalApiCostMicros` via `@yomi/shared/ai-pricing`.

Single chokepoint: `apps/backend/src/services/metering.ts` -> `chargeUsage()`
(owner bypass -> active-plan check -> `balance >= cost` -> record event +
consume). Callers: `routes/usage.ts`, `agent/run.ts`, and
`gateway/gateway-runner.ts`. Ledger: `services/credit-ledger.ts` +
`services/credit-pricing.ts`. Plan source of truth:
`packages/shared/src/plans.ts`. Billing/webhooks:
`apps/backend/src/routes/billing.ts`.

---

## Privacy

- Encrypted memory sync; user-owned export/delete.
- OAuth tokens are encrypted at rest.
- Hook logs must be PII-redacted.

---

## Models

```text
Fast path:  gpt-5.4-mini (OpenAI)
Agent path: gpt-5.5 (OpenAI)
Embeddings: text-embedding-3-small (OpenAI)
Speech:     OpenAI gpt-4o-mini-transcribe (STT only — replies are always text)
```

LLM calls go direct to OpenAI (`api.openai.com`) using the standard `OPENAI_*`
env vars.

---

## Deploys

The backend deploys itself on push to `main`
(`.github/workflows/deploy-backend.yml`, paths `apps/backend/**` /
`packages/**`), via a self-hosted runner on the EC2 box. Do not also run
`scripts/deploy-backend.sh` or `docker compose up` on the box for the same
commit; the manual deploy races the workflow and both die on a container-name
conflict. That script is the break-glass path for when the runner is down.

The frontend (Cloudflare Worker) also deploys itself on push to `main`
(`.github/workflows/deploy-landing.yml`, paths `apps/landing/**` / `packages/**`
/ `package.json` / `bun.lock`), via a GitHub-hosted runner. Manual deploy
remains available as a break-glass/on-demand path:

```bash
cd apps/landing && bun run deploy:production
```

The desktop client has been retired (see
`docs/adr/0002-retire-desktop-telegram-only.md`); Yomi's only interaction
surface is Telegram, managed via the web dashboard.

---

## Code Style & Cleanup

One-liners on non-obvious logic only. Never multi-line docstrings. Conventional
commits (`feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `chore:`,
`docs:`) are lowercase, no full stops, max 72 chars. Before pushing, ensure
`bun run test` and `bun run typecheck` pass or `gh run list` is green. Keep no
unused imports, no `as any` in non-test files, no noisy production debug logs,
and empty catches use `// ignore` or `// best-effort`.

---

## Agent Skills

### Issue tracker

Issues live in GitHub Issues on `arka6fx/yomi` via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See
`docs/agents/domain.md`.
