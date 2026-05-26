# Spec 00 — Overview

## Purpose

Single source of truth for Yomi's identity, principles, and phase map. Every other spec links back here for context.

## Invariants

- Every request is routed to either the fast path OR the agent path — never both, never mid-turn switching.
- The desktop shell has no AI logic. It is capture + UI only.
- LLM keys live in the cloud backend only.
- The local memory engine (`~/.yomi/`) is the user's persistent personal memory. It is filesystem-first and is not synced to Neon by default.
- Cloud RAG is separate from personal memory and indexes only files the user explicitly uploads.

## Detailed Design

### What is Yomi

Cross-platform AI buddy (Mac menu bar, Windows tray) that routes requests between a fast linear pipeline and a background ReAct agent loop. The differentiating insight: fast responses and autonomous tasks have opposite latency budgets, so they need different architectures — but users want both.

### Moat

| Advantage | Detail |
|---|---|
| Cross-platform | Mac menu bar + Windows tray |
| Dual architecture | Router chooses fast linear pipeline OR ReAct agent loop per request |
| Persistent memory | Local memory engine (`~/.yomi/`) - survives reboots, agent-curated |
| Optional document RAG | Cloud RAG on Neon for explicitly uploaded sources |
| Background agent | Autonomous tasks with ReAct loop + subagents |
| MCP ecosystem | Calendar, email, browser, Notion, Slack (Phase 2+) |
| Proactive hooks | Opt-in screen-context triggers |

### Glossary

| Term | Meaning |
|---|---|
| **Sidecar** | Local Bun process that ships with the desktop app. The brain. |
| **Shell** | The Electron app. Capture + UI + OS integration only. |
| **Fast path** | Linear pipeline: STT → screenshot → 1 LLM call → TTS |
| **Agent path** | ReAct loop with tools, MCP servers, and subagents |
| **Intent router** | First step of every turn. Returns `fast` or `agent`. |
| **Local memory** | `~/.yomi/` filesystem memory plus local indexes/profiles. Not cloud-synced by default. |
| **Cloud RAG** | Paid opt-in document retrieval over user-uploaded sources in Neon. |
| **Harness** | System prompt + tools + memory + code execution + hooks |
| **Compaction** | Recall pass + precision pass → reset context window |

### Phase Map

| Phase | Scope | Weeks |
|---|---|---|
| 0 — Spike | hotkey → Sarvam STT → screenshot → 1 LLM call → Sarvam TTS | 1–2 |
| 1 — Buddy | floating UI, tray/menubar shell, notepad init, permissions | 3–6 |
| 2 — Agent | intent router, ReAct loop, hooks lifecycle, MCP (calendar, email, browser), subagents | 7–12 |
| 3 — Accounts | Hono backend, Better Auth, Drizzle/Neon, Razorpay, LLM proxy (Vercel AI SDK), optional Cloud RAG | 13–15 |
| 4 — X-platform | Windows tray, Electron vs Tauri decision | 16–20 |
| 5 — Launch | Next.js landing, waitlist → download, pricing page, Discord | 21–22 |

## Files to change

None — this is a reference document, not implementation.

## Files to create

None — overview is kept in a single file.

## Open Questions

- Tauri port: decide at Phase 4 based on Electron pain points observed in Phase 0–3.
- Proactive hooks (screen-context changes): opt-in UX design needed before Phase 2.
