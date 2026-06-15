# Yomi — AGENTS.md

AI productivity assistant. Connects to your Google Workspace (Gmail, Calendar,
Drive) and to GitHub, Slack, Notion, Linear, Discord, and more so you can query,
draft, and act on your work in natural language. Sees your screen, hears your
voice, and accepts typed questions — from the desktop or Telegram, without
switching apps or copy-pasting context. Windows now; macOS coming soon.

---

## Design principle

| Request type           | Architecture                          | Budget                      |
| ---------------------- | ------------------------------------- | --------------------------- |
| Quick ask / screen Q&A | Linear pipeline                       | < 2 s                       |
| Screen-aware guidance  | Linear pipeline + vision              | < 3 s                       |
| Autonomous task        | LangGraph graph + connector tools     | seconds–minutes, foreground |

**Intent router** decides fast vs agent at the START of every turn. Never switch
models mid-turn — loses prompt cache and causes tool-vocab mismatch.

**Agent graph** (LangGraph StateGraph):
`orchestrator → planning → memory → execution → validation → recovery → completion`
Knowledge base (`~/.yomi/knowledge.db`) surfaces prior successful runs as planning
hints. `YOMI_LEGACY_AGENT=1` falls back to the old pipeline/agent.ts ReAct loop.

---

## Monorepo

```
apps/backend/        Hono/Bun — auth, billing, LLM proxy, metering
apps/desktop/        Electron — tray/menubar/notch, hotkeys, capture
apps/landing/        Next.js  — marketing, dashboard, account linking (Vercel)
apps/sidecar/        Bun      — router, fast pipeline, LangGraph agent, notepad
packages/agent-core/ ConnectorDef, ConnectorRegistry, LangGraph tools
packages/db/         Drizzle schema + Neon
packages/shared/     TypeScript contracts (desktop ↔ sidecar ↔ backend)
packages/ui-connectors/ Connector UI components
```

```bash
bun install && bun run dev        # install + run all in watch mode
```

---

## Stack (settled — do not relitigate)

- **LLM:** Vercel AI SDK (`ai`) with AI Credits / OpenAI-compatible inference
- **STT/TTS:** ElevenLabs (`scribe_v2`, `eleven_flash_v2_5`)
- **Desktop:** Electron (Tauri-ready). Never embed login in Electron window — device-code flow only
- **Backend:** Hono on Bun, Better Auth (Google + GitHub OAuth), Drizzle + Neon
- **Billing:** Dodo Payments
- **Agent orchestration:** LangGraph (`@langchain/langgraph` JS, in-process in sidecar)

---

## Architecture

```
DESKTOP SHELL  (apps/desktop — Electron)
  tray/menubar/notch · global hotkey · push-to-talk
  screen + mic capture · device-code auth
  ↕  local socket  (low-latency authenticated IPC)
LOCAL SIDECAR  (apps/sidecar — Bun)
  intent router · fast pipeline (STT → vision → LLM → TTS)
  LangGraph agent loop · connector tools · notepad memory
  ↕  authenticated HTTPS
CLOUD BACKEND  (apps/backend — Hono/Bun)
  Better Auth · Dodo webhooks · LLM proxy · usage metering · memory sync
```

---

## Harness

`harness = system prompt + tools + connectors + memory + hooks`

**Fast path:** `STT → speculative screenshot → 1 LLM call → TTS`
Tools: `look_at_screen`, `transcribe`, `speak`. No tool-selection loop.

**Agent path:** LangGraph graph + full tool set:
- Core: filesystem r/w, bash (sandboxed), web search/fetch, cron, messaging
- Connectors: Gmail, Google Calendar, Google Drive, GitHub, Notion, Slack,
  Linear, Postgres, MySQL, Discord — loaded from `ConnectorRegistry` based on
  which integrations the user has connected (`mcp_connections` table)

**Hooks:** `PreToolUse` (block dangerous calls) · `PostToolUse` (log, trim >N tokens)
· `Stop` (flush scratchpad) · `SessionEnd` (compact memory.md)

**Loop guards:** cap graph iterations (`AGENT_MAX_STEPS`) · max recoveries
(`AGENT_MAX_RECOVERIES`, default 2) · never switch models mid-turn

---

## Connectors (`packages/agent-core/src/connectors/`)

Each connector is a `ConnectorDef` with `id`, `auth` (oauth2 / api_key /
connection_string), `setup` instructions, and a `tools` factory returning AI SDK
tools. `ConnectorRegistry.getAllDefTools()` merges all connected providers into
the agent tool set. Adding a new connector = add one `ConnectorDef` to
`all-defs.ts`. No other code changes needed.

---

## Notepad (`~/.yomi/`)

```
yomi.md          ALWAYS preloaded — user identity, prefs, standing instructions
memory.md        Long-term memory (curated, compacted)
projects/<proj>/ context.md, scratchpad.md
sessions/        YYYY-MM-DD-topic.md  summaries
```

Always preload `yomi.md`; JIT-load everything else. Compact: recall → precision →
write `memory.md`. Retrieve: index → files → ripgrep. No vector DB needed.

---

## Cloudflare Workers — I/O rules (non-negotiable)

CF Workers bind native I/O (WebSockets, TCP, streams) to the originating request
context. Reusing any native I/O object across requests throws:
`"Cannot perform I/O on behalf of a different request. (I/O type: Native)"`

**Rules that must never be broken:**

- **Use `neon()` HTTP mode, never `Pool`.** `Pool` opens a WebSocket (native I/O)
  and cannot be reused across requests. `packages/db/src/index.ts` must import
  `neon` from `@neondatabase/serverless` and `drizzle` from `drizzle-orm/neon-http`.
  `Pool` / `drizzle-orm/neon-serverless` are banned in the backend Worker.

- **Never pass a cached promise to `ctx.waitUntil()` from a different request.**
  A promise created in request A carries its I/O context. Calling
  `ctx.waitUntil(thatPromise)` in request B is a violation.

- **Never store Request, Response, ReadableStream, or body references in
  module-level variables.** These are all native I/O. Only plain data (strings,
  plain objects, numbers) may live at module scope.

- **Singleton auth instance is safe** — `betterAuth()` itself holds no native I/O.
  It makes `fetch()` calls (not WebSockets) per request via the DB adapter.

---

## Database

Better Auth generates `user / session / account / verification`. User table extended:
```
plan                  "explore" | "pro" | "max"
subscription_status   "active" | "trialing" | "past_due" | "canceled" | null
daily_interaction_count  int, resets midnight UTC
daily_interaction_date   date
```

App tables (`packages/db/src/schema.ts`):
```
devices, subscriptions, usage_events (append-only), memory_blobs,
agent_runs, mcp_connections (oauth_tokens encrypted), hook_logs (PII redacted)
```

---

## Plans

| Plan    | Price      | Key limits                                                     |
| ------- | ---------- | -------------------------------------------------------------- |
| Explore | $0/mo      | 100 chats/month; limited voice/screen/memory; 2 connectors     |
| Pro     | $14.99/mo  | 2 000 chats/month; limited reasoning, voice, images; 8 connectors |
| Max     | $39.99/mo  | Higher reasoning, voice, and image limits; 8 connectors        |

Fair-use: never offer unlimited. Dodo USD: Pro = 1499¢, Max = 3999¢.
India-local: Pro ₹999/mo, Max ₹2 999/mo.
Billing routes: `apps/backend/src/routes/billing.ts`.

---

## Privacy (non-negotiable)

- Local-by-default: STT + screen on-device; only the distilled prompt leaves
- Visible status: tray/notch pill when listening or capturing. No silent recording
- Per-app blocklist: password managers and banking apps never captured
- Yomi's own window excluded from screen-shares
- Encrypted memory sync; user-owned export/delete

---

## Models (2026-06)

```
Fast path:  gpt-4.1-mini (AI Credits / OpenAI-compatible)
Agent path: gpt-4.1 (AI Credits / OpenAI-compatible)
Speech:     ElevenLabs scribe_v2 + eleven_flash_v2_5
```

---

## Desktop releases

Production web/backend deploys from `main`. Desktop installers are separate:
publish Windows releases to `arka6fx/yomi-releases` via `.github/workflows/release.yml`.

When STT/TTS or sidecar code changes, build and publish a new desktop installer.
The installer must include `apps/sidecar/dist/sidecar-win32-x64.exe`; verify the
binary contains `eleven_flash_v2_5` and `scribe_v2` and does not contain
`amazon.nova-2-sonic-v1:0`, `minimax.minimax-m2.5`, or `Bedrock` before release.

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
