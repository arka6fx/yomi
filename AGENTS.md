# Yomi — AGENTS.md

Cross-platform AI buddy. Sees your screen, hears your voice, acts so you touch
your laptop less. Mac (menu bar / notch), Windows (system tray).

---

## Design principle

| Request type           | Architecture             | Budget                      |
| ---------------------- | ------------------------ | --------------------------- |
| Quick ask / screen Q&A | Linear pipeline          | < 2 s                       |
| Screen-aware guidance  | Linear pipeline + vision | < 3 s                       |
| Autonomous task        | ReAct loop + subagents   | seconds–minutes, background |

**Intent router** decides fast vs agent at the START of every turn. Never route
mid-turn — switching models loses the prompt cache and causes tool-vocab
mismatch.

---

## Monorepo

```
apps/backend/   Hono/Bun — auth, billing, LLM proxy, metering
apps/desktop/   Electron — tray/menubar, hotkeys, capture, floating UI
apps/landing/   Next.js  — marketing + waitlist (Vercel)
apps/sidecar/   Bun      — router, fast pipeline, agent loop, notepad
packages/db/    Drizzle schema + Neon
packages/shared TypeScript contracts (desktop ↔ sidecar ↔ backend)
packages/config tsconfig + eslint presets
```

```bash
bun install && bun run dev        # install + run all in watch mode
cd apps/backend  && bun run dev   # :3001
cd apps/sidecar  && bun run dev   # :3002
cd apps/landing  && bun run dev   # :3000
cd apps/desktop  && bun run dev   # Electron
```

---

## Stack (settled — do not relitigate)

| Layer      | Choice                                                                           |
| ---------- | -------------------------------------------------------------------------------- |
| Landing    | Next.js 16 / Vercel                                                              |
| Backend    | Hono on Bun                                                                      |
| Database   | Postgres — Neon (serverless)                                                     |
| ORM        | Drizzle                                                                          |
| Auth       | Better Auth (Drizzle adapter, orgs plugin for Team tier) — Google + GitHub OAuth |
| Billing    | Razorpay                                                                         |
| LLM SDK    | Vercel AI SDK (`ai` package) with `@ai-sdk/openai`                               |
| Speech STT | ElevenLabs `scribe_v2`                                                           |
| Speech TTS | ElevenLabs `eleven_flash_v2_5` (MP3, premade voice)                              |
| Desktop    | Electron v1 (Tauri-ready — brain stays in sidecar)                               |
| Sidecar    | Bun service (ships with desktop app)                                             |
| Packages   | Bun workspaces + Turborepo                                                       |

- LLM routing uses an OpenAI-compatible API through AI Credits. Set
  `OPENAI_API_KEY` and `OPENAI_BASE_URL`.
- Desktop auth: system-browser device-code flow. Never embed login in Electron
  window.
- **Primary LLM provider:** AI Credits/OpenAI-compatible endpoint via
  `@ai-sdk/openai`.
- Do not add alternate LLM provider routing unless explicitly requested.

---

## Architecture

```
DESKTOP SHELL  (apps/desktop — Electron)
  tray/menubar · global hotkey · push-to-talk
  screen + mic capture · floating UI · device-code auth
  ↕  local socket  (low-latency authenticated IPC)
LOCAL SIDECAR  (apps/sidecar — Bun)
  intent router · fast pipeline (STT → vision → LLM → TTS)
  ReAct agent loop · MCP + subagents · notepad memory
  ↕  authenticated HTTPS
CLOUD BACKEND  (apps/backend — Hono/Bun)
  Better Auth · Razorpay webhooks · LLM proxy · usage metering · memory sync
```

---

## Harness (where 80% of engineering effort goes)

`harness = system prompt + tools/MCP + memory + code execution + hooks`

**Fast path:**
`STT → speculative screenshot → 1 LLM call (cached system prompt + yomi.md) → TTS`
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
projects/<proj>/
  context.md     Project facts + decisions
  scratchpad.md  Agent working notes (ephemeral)
sessions/
  YYYY-MM-DD-topic.md  Session summaries
```

**Load:** always preload `yomi.md`; JIT-load everything else on demand;
metadata-only by default. **Compact:** recall pass → precision pass → write to
`memory.md`, reset live window. **Retrieve:** agent reads index → `list_files` →
`read_file` → `search` (ripgrep). No vector DB needed at single-user scale.

---

## Database

Better Auth generates `user / session / account / verification`. User table
extended with:

```
plan                  "explore" | "pro" | "max"  (default "explore")
subscription_status   "active" | "trialing" | "past_due" | "canceled" | null
trial_ends_at         timestamp — 30-day explore trial end
daily_interaction_count  int, resets midnight UTC
daily_interaction_date   date
```

App tables (Drizzle schema in `packages/db/src/schema.ts`):

```
devices         id, user_id, os, app_version, last_seen
subscriptions   id, user_id, razorpay_customer_id, razorpay_sub_id,
                plan, status, current_period_end
usage_events    id, user_id, device_id, kind(stt|fast_query|agent_run|tts),
                model, input_tokens, output_tokens, cost_cents, created_at
memory_blobs    id, user_id, path, content_hash, updated_at
agent_runs      id, user_id, status, task, started_at, ended_at, summary
mcp_connections id, user_id, provider, oauth_tokens(encrypted), scopes
hook_logs       id, user_id, run_id, hook, tool, decision, payload_redacted, created_at
```

`usage_events` append-only · `oauth_tokens` encrypted at rest · PII redacted in
`hook_logs`.

---

## Plans

| Plan    | Price     | Key limits                                                                         |
| ------- | --------- | ---------------------------------------------------------------------------------- |
| Explore | $0/mo     | 30-day trial; 150 total interactions; voice + screen; no agents                    |
| Pro     | $9.99/mo  | Unlimited standard interactions\*; voice 200/day; screen analysis; no agents       |
| Max     | $24.99/mo | Everything in Pro + agents/sub-agents; 10 000 agent runs/day; background execution |

\* Fair-use: chat 10 000/day. Voice capped at 200/day on Pro, 10 000/day on Max.

Razorpay plan amounts: Pro = ₹999, Max = ₹2 499 (cents). Set `RAZORPAY_KEY_ID` +
`RAZORPAY_KEY_SECRET`.

---

## Implementation Order (specs/)

Specs are numbered in the order they should be implemented. 00 and 01 are
reference docs.

| Spec | File                          | Scope                                                                                                 |
| ---- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| 02   | `02-sidecar-fast-pipeline`    | OpenAI-compatible fast path + visual guide                                                            |
| 03   | `03-desktop-shell`            | Electron main: sidecar spawn, hotkey, desktopCapturer, IPC bridge, overlay window                     |
| 04   | `04-desktop-ui`               | Renderer: floating overlay, Zustand store, audio capture, streaming response                          |
| 05   | `05-speech-stt`               | STT abstraction: ElevenLabs scribe_v2 + VAD                                                           |
| 06   | `06-speech-tts`               | TTS abstraction: ElevenLabs eleven_flash_v2_5 (MP3)                                                   |
| 07   | `07-sidecar-router`           | Intent router: fast vs agent classification                                                           |
| 08   | `08-sidecar-agent`            | ReAct loop, tools, MCP, subagents, sandbox                                                            |
| 09   | `09-harness`                  | System prompt, hooks, loop guards                                                                     |
| 10   | `10-memory`                   | Notepad (~/.yomi/), compaction, retrieval                                                             |
| 11   | `11-database`                 | Drizzle schema + Neon client                                                                          |
| 12   | `12-backend`                  | Hono routes, Better Auth, LLM proxy, metering                                                         |
| 13   | `13-pricing`                  | Plans, Razorpay, metering logic                                                                       |
| 14   | `14-landing-page`             | Next.js marketing site + waitlist                                                                     |
| 16   | `16-windows-app-automation`   | UIA Act mode: C# helper + sidecar client, confirm channel, safety blocklist                           |
| 17   | `17-browser-automation`       | Playwright MCP via a generic sidecar MCP client                                                       |
| 18   | `18-automation-orchestration` | LangGraph AutomationGraph, mission-control events, provider-routed sub-agents, learning ← **current** |

---

## Privacy (non-negotiable)

- Local-by-default: STT + screen analysis on-device; only the distilled prompt
  leaves the machine.
- Visible status: tray/notch pill always shows when Yomi is listening or
  capturing. No silent recording.
- Per-app blocklist: password managers and banking apps are never captured.
- Window content-protection: Yomi's own window excluded from screen-shares.
- Encrypted memory sync; user-owned export/delete; clear data-retention policy.

---

## Models (2026-05)

```
Fast path:  gpt-4.1-mini
Agent path: gpt-4.1
Heavy:      gpt-4.1
```

Use the AI Credits/OpenAI-compatible endpoint for LLM calls. Keep ElevenLabs as
the only STT/TTS provider unless explicitly changed.

---

## Code comments

Keep small, purposeful comments throughout the codebase. A one-liner on
non-obvious logic, a short section header where a file has distinct regions, a
brief note on a workaround or constraint. Comments should be short — never
multi-line blocks or docstrings. The goal is to make the code scannable and
self-explaining without over-documenting obvious things.

---

## Commit messages

Use conventional commits. Pick the right prefix:

| Prefix      | When                                  |
| ----------- | ------------------------------------- |
| `feat:`     | new user-facing feature               |
| `fix:`      | bug fix                               |
| `refactor:` | code restructure, no behaviour change |
| `perf:`     | performance improvement               |
| `style:`    | formatting, naming, no logic change   |
| `test:`     | adding or updating tests              |
| `chore:`    | deps, config, tooling, CI             |
| `docs:`     | documentation only                    |

Message style: short, human, lowercase — describe the _what_ in 3–6 words. No
full stops. Examples: `feat: speaker mute toggle`, `fix: tts playback order`,
`chore: upgrade sarvam to v3`
