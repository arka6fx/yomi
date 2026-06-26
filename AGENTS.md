# Yomi — AGENTS.md

AI productivity assistant. Connects to Google Workspace (Gmail, Calendar, Drive) and
GitHub, Slack, Notion, Linear, Discord, and more. Accepts desktop voice, desktop text,
screen Q&A, and Telegram messages. Backend-first for Telegram and durable memory.

---

## Design principle

| Request type           | Architecture                   | Budget           |
| ---------------------- | ------------------------------ | ---------------- |
| Quick ask / screen Q&A | Linear pipeline                | < 2 s            |
| Connector task         | Agent loop + connector tools   | seconds–minutes  |
| Telegram task          | Backend agent + memory/tools   | seconds–minutes  |

**Intent router** decides fast vs agent at start of every turn. Never switch models
mid-turn — loses prompt cache and causes tool-vocab mismatch.

---

## Monorepo

```
apps/backend/        Hono/Bun — auth, billing, LLM proxy, metering
apps/desktop/        Electron — tray/menubar/notch, hotkeys, capture
apps/landing/        Next.js  — marketing, dashboard, account linking
apps/sidecar/        Bun      — router, fast pipeline, agent loop, notepad
packages/agent-core/ ConnectorDef, ConnectorRegistry, agent tools
packages/db/         Drizzle schema + Neon
packages/shared/     TypeScript contracts (desktop ↔ sidecar ↔ backend)
packages/ui-connectors/ Connector UI components
```

```bash
bun install && bun run dev        # install + run all in watch mode
```

---

## Stack

- **LLM:** Vercel AI SDK (`ai`) with AI Credits / OpenAI-compatible inference
- **STT/TTS:** ElevenLabs (`scribe_v2`, `eleven_flash_v2_5`)
- **Desktop:** Electron (Tauri-ready). Device-code flow only for auth
- **Backend:** Hono on Bun, Better Auth (Google + GitHub OAuth), Drizzle + Neon
- **Billing:** Dodo Payments
- **Agent orchestration:** AI SDK agent loop with connector tools; backend agent for Telegram

---

## Architecture

```
DESKTOP SHELL  (Electron)
  tray/menubar/notch · global hotkey · push-to-talk · screen + mic capture
  ↕ local socket (low-latency authenticated IPC)
LOCAL SIDECAR  (Bun)
  intent router · fast pipeline (STT → optional screenshot → LLM → TTS)
  agent loop · connector tools · local notepad memory
  ↕ authenticated HTTPS
CLOUD BACKEND  (Hono/Bun)
  Better Auth · Dodo webhooks · LLM proxy · usage metering · Telegram · canonical memory
```

---

## Harness

`harness = system prompt + tools + connectors + memory + hooks`

**Fast path:** `STT → optional screenshot → 1 LLM call → TTS`
Tools: `look_at_screen`, `transcribe`, `speak`. No tool-selection loop.

**Agent path:** AI SDK loop + full tool set:
- Core: filesystem r/w, bash (sandboxed), web search/fetch, cron, messaging, memory
- Connectors: Gmail, Google Calendar, Google Drive, GitHub, Notion, Slack,
  Linear, Postgres, MySQL, Discord — loaded from `ConnectorRegistry`

**Hooks:** `PreToolUse` (block dangerous) · `PostToolUse` (log, trim tokens)
· `Stop` (flush scratchpad) · `SessionEnd` (compact memory.md)

**Loop guards:** `AGENT_MAX_STEPS` cap · `AGENT_MAX_RECOVERIES` (default 2)

---

## Connectors (`packages/agent-core/src/connectors/`)

Each connector is a `ConnectorDef` with `id`, `auth`, `setup` instructions, and a
`tools` factory. `ConnectorRegistry.getAllDefTools()` merges all connected providers.
Adding a new connector = add one `ConnectorDef` to `all-defs.ts`. No other changes.

---

## Notepad (`~/.yomi/`)

```
yomi.md          ALWAYS preloaded — user identity, prefs, standing instructions
memory.md        Long-term memory (curated, compacted)
projects/<proj>/ context.md, scratchpad.md
sessions/        YYYY-MM-DD-topic.md  summaries
```

Always preload `yomi.md`; JIT-load everything else. Backend memory is canonical for
durable facts, document provenance, Telegram, and connector agents. Sidecar memory is
local/private working memory and syncs durable facts to `/api/memory/*` when signed in.

---

## Cloudflare Workers — I/O rules

CF Workers bind native I/O to the originating request context.

- **Use `neon()` HTTP mode, never `Pool`.** `Pool` opens a WebSocket and cannot be
  reused across requests. Import `neon` from `@neondatabase/serverless` and `drizzle`
  from `drizzle-orm/neon-http`. `Pool` is banned in the backend Worker.
- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
- **Never store Request, Response, ReadableStream, or body references in module-level
  variables.** Only plain data (strings, plain objects, numbers) may live at module scope.
- **Singleton auth instance is safe** — `betterAuth()` makes `fetch()` calls per request.

---

## Database

Better Auth: `user / session / account / verification`. User table extended with
`plan`, `subscription_status`, `trial_start_date`, `trial_end_date`,
`current_period_end`, `dodo_subscription_id`.

Billing/metering tables: `usage_events` (append-only), `credit_accounts` (balance +
lifetime totals), `credit_grants` (per-batch with expiry), `credit_transactions`
(audit log), `payment_records`, `processed_payment_events`, `subscriptions`.

Other app tables: `devices`, `agent_runs`, `agent_sessions`, `agent_messages`,
`memory_blobs`, `memory_entries`, `memory_sources`, `memory_relations`,
`memory_embeddings`, `rag_sources / rag_documents / rag_chunks / rag_embeddings /
rag_retrieval_logs`, `mcp_connections` (oauth_tokens encrypted), `platform_connections`,
`pending_actions`, `hook_logs` (PII redacted), `linking_codes`, `telegram_link_tokens`,
`device_codes`. Schema: `packages/db/src/schema.ts`.

---

## Plans & credits

Billing is **pure credits** — a single credit balance is the only usage gate.
Per-feature monthly caps were removed; connectors are unlimited on every plan.

| Plan    | Price      | Monthly credits |
| ------- | ---------- | --------------- |
| Explore | $0/mo      | 100 (30-day free trial) |
| Pro     | $14.99/mo  | 2 500           |
| Max     | $39.99/mo  | 10 000          |

Credit costs: chat 1 · image/screen analyze 1 · voice 2/min · Telegram message 1.
Out of credits → Explore must subscribe, Pro/Max buy a credit pack. Owner email
bypasses all checks. Dodo USD: Pro 1499¢, Max 3999¢. Credit packs: 500/$4.99,
2 000/$14.99, 6 000/$39.99.

Single chokepoint: `apps/backend/src/services/metering.ts` → `chargeUsage()`
(owner bypass → active-plan check → `balance ≥ cost` → record event + consume).
Callers: `routes/usage.ts` (`/interactions/reserve`), `agent/run.ts` (Telegram
bot_message), `gateway/gateway-runner.ts` (telegram voice/image). Ledger:
`services/credit-ledger.ts` + `services/credit-pricing.ts`. Plan source of truth:
`packages/shared/src/plans.ts`. Billing/webhooks: `apps/backend/src/routes/billing.ts`.

---

## Privacy

- Local-by-default: STT + screen on-device; only distilled prompt leaves
- Visible status: tray/notch pill when listening or capturing
- Per-app blocklist: password managers and banking apps never captured
- Yomi window excluded from screen-shares
- Encrypted memory sync; user-owned export/delete

---

## Models

```
Fast path:  gpt-5.5-mini (AI Credits / OpenAI-compatible)
Agent path: gpt-5.5 (AI Credits / OpenAI-compatible)
Speech:     ElevenLabs scribe_v2 + eleven_flash_v2_5
```

---

## Desktop releases

**CRITICAL: All releases go to `arka6fx/yomi-releases` only. Never create tags or releases in the main yomi repo.**

Production web/backend deploys from `main`. Desktop installers published as GitHub
releases on `arka6fx/yomi-releases` via `.github/workflows/release.yml`.

### Release process (follow every time):

1. **Push all changes to `main`** on the yomi repo first.
2. **Trigger the release workflow:** `gh workflow run release.yml --ref main -f version=<ver> -f notes="<desc>"`
3. **Wait for the workflow to complete** (~45 min). It builds the sidecar binary, Electron app, and publishes the `.exe` + `.blockmap` + `latest.yml` to `arka6fx/yomi-releases`.
4. **Never create a release manually with `gh release create`.** Always use the workflow.
5. **Never create git tags in the yomi repo.** Tags are auto-managed by the release workflow on yomi-releases.
6. **The landing page download (/api/download) automatically picks up the latest asset** from yomi-releases — no manual update needed.

### Installer validation:

The installer must include `apps/sidecar/dist/sidecar-win32-x64.exe`; verify the
binary contains `eleven_flash_v2_5` and `scribe_v2` and does not contain
`amazon.nova-2-sonic-v1:0` or `minimax.minimax-m2.5` before release.

---

## Code style

One-liners on non-obvious logic only. Never multi-line docstrings. Conventional
commits: `feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `chore:`, `docs:`.
Lowercase, no full stops, max 72 chars summary. No em-dashes.

---

## Cleanup (always do before pushing)

- `bun run ci` passes locally or `gh run list` shows green
- No unused imports, no `as any` in non-test files
- No noisy debug logs in production paths
- Empty catches are intentional (`// ignore` or `// best-effort`)
- Conventional commit messages on all pushes
