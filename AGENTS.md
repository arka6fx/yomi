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

- **LLM:** Vercel AI SDK (`ai` + `@ai-sdk/openai`) via OpenAI-compatible endpoint
- **STT/TTS:** ElevenLabs `scribe_v2` / `eleven_flash_v2_5` (MP3)
- **Desktop:** Electron (Tauri-ready). Never embed login in Electron window — device-code flow only
- **Backend:** Hono on Bun, Better Auth (Google + GitHub OAuth), Drizzle + Neon
- **Billing:** Razorpay
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
  Better Auth · Razorpay webhooks · LLM proxy · usage metering · memory sync
  Messaging Gateway (Telegram / Discord / Slack — polling + webhooks)
```

---

## Messaging Gateway

Users link their account via a 6-character code flow:
1. Message the bot on Telegram or Discord (after adding to a server)
2. Bot replies with a linking code (stored in `linking_codes`, expires in 10 min)
3. Enter code on `/link` page → inserts `platform_connections` row
4. Subsequent messages route from gateway → backend queue → sidecar polling → LLM

Platform adapters live in `apps/backend/src/gateway/platforms/`. Each implements
`PlatformAdapter` (send/receive). The sidecar is platform-agnostic — it only sees
`GatewayMessage { platform, chatId, userId, text }`.

---

## Harness (where 80% of engineering effort goes)

`harness = system prompt + tools/MCP + memory + code execution + hooks`

**Fast path:** `STT → speculative screenshot → 1 LLM call → TTS`
Tools: `look_at_screen`, `transcribe`, `speak`. No tool-selection loop.

**Agent path:** filesystem r/w · bash (sandboxed) · web search/fetch · cursor
automation · MCP servers (calendar, email, Notion, Slack, browser).

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
agent_runs, mcp_connections (oauth_tokens encrypted), hook_logs (PII redacted),
platform_connections, linking_codes
```

---

## Plans

| Plan    | Price      | Key limits                                                         |
| ------- | ---------- | ------------------------------------------------------------------ |
| Explore | $0/mo      | 100 chats/month; limited voice/screen/memory; no automation        |
| Pro     | $14.99/mo  | 2 000 chats/month; limited reasoning, voice, images, automation    |
| Max     | $39.99/mo  | Higher reasoning, voice, image, and foreground automation limits   |

Fair-use: never offer unlimited. Razorpay USD: Pro = 1499¢, Max = 3999¢.
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
| 13 | `13-pricing` | Plans, Razorpay, metering |
| 14 | `14-landing-page` | Next.js marketing site + waitlist |
| 16 | `16-windows-app-automation` | UIA Act mode, safety blocklist |
| 17 | `17-browser-automation` | Playwright MCP via sidecar |
| 18 | `18-automation-orchestration` | LangGraph, sub-agents ← **current** |
| 19 | `19-hermes-features.md` | Cloud messaging gateway architecture |
| 20 | `20-bot-setup.md` | Bot setup + linking flow |

---

## Privacy (non-negotiable)

- Local-by-default: STT + screen on-device; only the distilled prompt leaves
- Visible status: tray/notch pill when listening or capturing. No silent recording
- Desktop automation is foreground-specific only
- Per-app blocklist: password managers and banking apps never captured
- Yomi's own window excluded from screen-shares
- Encrypted memory sync; user-owned export/delete

---

## Models (2026-05)

```
Fast path:  gpt-4.1-mini
Agent path: gpt-4.1
Heavy:      gpt-4.1
```

---

## Code style

Small purposeful comments — one-liners on non-obvious logic, short section
headers. Never multi-line blocks or docstrings. Use conventional commits:
`feat:`, `fix:`, `refactor:`, `perf:`, `style:`, `test:`, `chore:`, `docs:`.
Short, lowercase, no full stops. Example: `feat: speaker mute toggle`.
