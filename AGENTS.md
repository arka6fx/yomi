# Yomi — AGENTS.md

Cross-platform AI buddy. Sees your screen, hears your voice, acts so you touch
your laptop less. Mac (menu bar / notch), Windows (system tray).

---

## Design principle

| Request type           | Architecture             | Budget                      |
| ---------------------- | ------------------------ | --------------------------- |
| Quick ask / screen Q&A | Linear pipeline          | < 2 s                       |
| Screen-aware guidance  | Linear pipeline + vision | < 3 s                       |
| Autonomous task        | ReAct loop + subagents   | seconds–minutes, foreground |

**Intent router** decides fast vs agent at the START of every turn. Never switch
models mid-turn — loses prompt cache and causes tool-vocab mismatch.

---

## Monorepo

```
apps/backend/   Hono/Bun — auth, billing, LLM proxy, metering, messaging gateway
apps/desktop/   Electron — tray/menubar/notch, hotkeys, capture, Mission Control
apps/landing/   Next.js  — marketing, dashboard, account linking (Vercel)
apps/sidecar/   Bun      — router, fast pipeline, agent loop, notepad
packages/db/    Drizzle schema + Neon
packages/shared TypeScript contracts (desktop ↔ sidecar ↔ backend)
packages/config tsconfig + eslint presets
```

```bash
bun install && bun run dev        # install + run all in watch mode
```

---

## Stack (settled — do not relitigate)

- **LLM:** Vercel AI SDK (`ai` + `@ai-sdk/openai`) via AWS Bedrock mantle (MiniMax M2.5)
- **STT/TTS:** AWS Bedrock Nova Sonic (Converse API, IAM auth)
- **Desktop:** Electron (Tauri-ready). Never embed login in Electron window — device-code flow only
- **Backend:** Hono on Bun, Better Auth (Google + GitHub OAuth), Drizzle + Neon
- **Billing:** Dodo Payments
- **Primary LLM provider:** AI Credits/OpenAI-compatible. Don't add alternative routing unless asked.

---

## Architecture

```
DESKTOP SHELL  (apps/desktop — Electron)
  tray/menubar/notch · global hotkey · push-to-talk
  screen + mic capture · Mission Control · device-code auth
  ↕  local socket  (low-latency authenticated IPC)
LOCAL SIDECAR  (apps/sidecar — Bun)
  intent router · fast pipeline (STT → vision → LLM → TTS)
  ReAct agent loop · MCP + subagents · notepad memory
  ↕  authenticated HTTPS
CLOUD BACKEND  (apps/backend — Hono/Bun)
  Better Auth · Dodo webhooks · LLM proxy · usage metering · memory sync
  Messaging Gateway (Telegram / Discord — will provide later)
```

---

## Messaging Gateway (will provide later)

Telegram/Discord bots via polling, code-linking flow, gateway routes, and platform
adapters in `apps/backend/src/gateway/` — all commented out until first public release.

---

## Harness (where 80% of engineering effort goes)

`harness = system prompt + tools/MCP + memory + code execution + hooks`

**Fast path:** `STT → speculative screenshot → 1 LLM call → TTS`
Tools: `look_at_screen`, `transcribe`, `speak`. No tool-selection loop.

**Agent path:** filesystem r/w · bash (sandboxed) · web search/fetch · cursor
automation · MCP servers (calendar, email, Notion, Slack). Browser automation
commented out — will provide later.

**Session lifecycle:**
```
SessionStart → UserPromptSubmit
  → [per-tool] PreToolUse → Tool → PostToolUse → (loop or next)
  → Stop → SessionEnd
```

**Hooks:** `PreToolUse` (block dangerous calls) · `PostToolUse` (log, trim >N
tokens) · `Stop` (flush scratchpad) · `SessionEnd` (compact memory.md)

**Loop guards:** cap ReAct iterations · trim tool output middle if >N tokens ·
progress check every few steps · never switch models mid-turn

---

## Notepad (`~/.yomi/`)

```
yomi.md          ALWAYS preloaded — user identity, prefs, standing instructions
memory.md        Long-term memory (curated, compacted)
memory-index.md  One-line manifest per memory file
projects/<proj>/ context.md, scratchpad.md
sessions/        YYYY-MM-DD-topic.md  summaries
```

Load: always preload `yomi.md`; JIT-load everything else. Compact: recall →
precision → write `memory.md`, reset live window. Retrieve: index → files →
ripgrep. No vector DB needed.

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
# platform_connections, linking_codes — commented out, will provide later
```

---

## Plans

| Plan    | Price      | Key limits                                                         |
| ------- | ---------- | ------------------------------------------------------------------ |
| Explore | $0/mo      | 100 chats/month; limited voice/screen/memory; no automation        |
| Pro     | $14.99/mo  | 2 000 chats/month; limited reasoning, voice, images, automation    |
| Max     | $39.99/mo  | Higher reasoning, voice, image, and foreground automation limits   |

Fair-use: never offer unlimited. Dodo USD: Pro = 1499¢, Max = 3999¢.
India-local: Pro ₹999/mo, Max ₹2 999/mo.

---

## Specs (implementation order)

| # | File | Scope |
| - | ---- | ----- |
| 02 | `02-sidecar-fast-pipeline` | Fast path + visual guide |
| 03 | `03-desktop-shell` | Electron main: sidecar spawn, hotkey, IPC, tray |
| 04 | `04-desktop-ui` | Notch, Mission Control, audio, streaming |
| 05 | `05-speech-stt` | ElevenLabs scribe_v2 + VAD |
| 06 | `06-speech-tts` | ElevenLabs eleven_flash_v2_5 |
| 07 | `07-sidecar-router` | Fast vs agent classification |
| 08 | `08-sidecar-agent` | ReAct loop, tools, MCP, sandbox |
| 09 | `09-harness` | System prompt, hooks, loop guards |
| 10 | `10-memory` | Notepad, compaction, retrieval |
| 11 | `11-database` | Drizzle schema + Neon client |
| 12 | `12-backend` | Hono routes, Better Auth, LLM proxy, metering |
| 13 | `13-pricing` | Plans, Dodo Payments, metering |
| 14 | `14-landing-page` | Next.js marketing site + waitlist |
| 16 | `16-windows-app-automation` | UIA Act mode, safety blocklist |
| 17 | `17-browser-automation` | Playwright MCP via sidecar ← **will provide later** |
| 18 | `18-automation-orchestration` | LangGraph, sub-agents ← **will provide later** |
| 19 | `19-hermes-features.md` | Cloud messaging gateway architecture ← **will provide later** |
| 20 | `20-bot-setup.md` | Bot setup + linking flow ← **will provide later** |

---

## Privacy (non-negotiable)

- Local-by-default: STT + screen on-device; only the distilled prompt leaves
- Visible status: tray/notch pill when listening or capturing. No silent recording
- Desktop automation is foreground-specific only
- Per-app blocklist: password managers and banking apps never captured
- Yomi's own window excluded from screen-shares
- Encrypted memory sync; user-owned export/delete

---

## Models (2026-06)

```
Fast path:  minimax.minimax-m2.5 (Bedrock mantle)
Agent path: minimax.minimax-m2.5 (Bedrock mantle)
Speech:     Nova 2 Sonic (Bedrock Converse API)
```

---

## Desktop releases

Production web/backend deploys come from this repo's `main` branch. Desktop
installers are separate: always publish Windows releases to
`arka6fx/yomi-releases` using `.github/workflows/release.yml`.

When STT/TTS or sidecar code changes, deploying backend/landing is not enough.
Build and publish a new desktop installer so the packaged sidecar is updated.
The installer must include `apps/sidecar/dist/sidecar-win32-x64.exe`; verify the
fresh binary contains `amazon.nova-2-sonic-v1:0` and does not contain legacy
`STT proxy error` or `/api/v1/elevenlabs/stt` strings before release.

---

## Code style

Small purposeful comments — one-liners on non-obvious logic, short section
headers. Never multi-line blocks or docstrings. Use conventional commits:
`feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `chore:`, `docs:`.
Short, lowercase, no full stops. No em-dashes. Single line preferred, max 72
chars in the summary line. Break long explanations into the body after a blank
line. Example: `feat: speaker mute toggle`.

---

## Billing Architecture (2026-06)

**Design:** Pre-created Dodo products. USD canonical, 8 currency display layer
via `CF-IPCountry`. Pre-created product IDs from env vars.

```
Checkout: POST /create-subscription → Dodo Checkout Session
Credits:  POST /create-credit-pack → Dodo Checkout Session
Plans:   GET /plans → local estimates + "Charged in USD" notice
Cancel:  POST /cancel-subscription → Dodo subscription cancel
Webhook: POST /webhook → Standard Webhooks verification, idempotent event dedup
```

**Key numbers:** Pro $14.99/mo (1499¢), Max $39.99/mo (3999¢).
7-day past_due grace.
Plans configured in `apps/backend/src/routes/billing.ts:32`.

**Dodo flow:**
1. Create subscription and credit-pack products in Dodo Dashboard
2. Set `DODO_PRODUCT_PRO`, `DODO_PRODUCT_MAX`, and credit-pack product IDs
3. Backend creates a Dodo Checkout Session
4. Frontend redirects to Dodo checkout URL
5. Dodo sends webhook → backend activates subscription or grants credits

**Currency display** (`apps/backend/src/routes/billing.ts:62`): USD, INR, EUR,
GBP, AUD, CAD, BRL, SGD. Manual rates (no live FX API until 500+ customers).

**Grace period:** `hasBillablePlanAccess()` allows 7 days past_due. Webhook
payment failure → status = past_due → billing warning in dashboard.

## Messaging Gateway (will provide later)

Telegram/Discord bots, platform adapters, gateway routes, linking flow — all
commented out with stubs. Desktop `send_whatsapp_message` tool also stubbed.

## Removed / commented out (2026-06)
- WhatsApp cloud adapter (762 lines: adapter, tests, webhooks, routes, types)
- Slack cloud adapter (189 lines: adapter, routes, types)
- Legacy billing integration — replaced by Dodo Payments
- Browser automation (Playwright MCP, browser tools, automation agents) — commented out for later
- Messaging gateway (Telegram/Discord bots, gateway routes, adapter code) — commented out for later
- send_whatsapp_message tool — commented out
- ElevenLabs STT (scribe_v2) and TTS (eleven_flash_v2_5) — replaced by Nova Sonic
- GPT-4.1-mini / GPT-4.1 LLM — replaced by MiniMax M2.5 via Bedrock mantle

## Cleanup (always do before pushing)
- Check CI passes: `bun run ci` locally or `gh run list` for status
- No unused imports (`Zap` in dashboard was removed)
- No `as any` in non-test files (download page uses `GitHubAsset`/`GitHubRelease` types)
- No noisy debug logs in production paths (proxy.ts router middleware removed)
- Empty catches intentional (`// ignore` or `// best-effort`)
- Conventional commit messages on all pushes
