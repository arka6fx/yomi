# Spec 01 — Architecture

## Purpose

Define the four-layer architecture, IPC contracts, data flows, and port
assignments. This is the boundary document — it defines what each layer owns and
what it may not own.

## Invariants

- The desktop shell NEVER makes direct LLM calls. All AI goes through the
  sidecar.
- The sidecar NEVER holds API keys. It proxies requests to the backend.
- Raw screen captures never leave the device. Audio is processed through the
  configured Sarvam STT path; only the resolved transcript and prompt context
  needed for the model leave the machine.
- The fast path has a strict < 2s budget end-to-end (hotkey press to first audio
  byte).

## Detailed Design

### Four Layers

```
┌──────────────────────────────────────────────────────┐
│  LAYER 1: DESKTOP SHELL  (apps/desktop — Electron)   │
│  Owns: OS integration, capture, hotkeys, UI          │
│  Does NOT own: AI logic, API keys, memory files      │
└──────────────────┬───────────────────────────────────┘
                   │  IPC: local HTTP on 127.0.0.1:3002
                   │  Auth: SIDECAR_SECRET header
┌──────────────────▼───────────────────────────────────┐
│  LAYER 2: LOCAL SIDECAR  (apps/sidecar — Bun)        │
│  Owns: router, fast pipeline, agent loop, memory     │
│  Does NOT own: API keys, accounts, billing           │
└──────────────────┬───────────────────────────────────┘
                   │  HTTPS to cloud backend
                   │  Auth: JWT from Better Auth session
┌──────────────────▼───────────────────────────────────┐
│  LAYER 3: CLOUD BACKEND  (apps/backend — Hono/Bun)   │
│  Owns: auth, billing, LLM proxy, usage metering      │
│  Does NOT own: UI, capture, memory files             │
└──────────────────────────────────────────────────────┘

  LAYER 4: LANDING  (apps/landing — Next.js)
  Fully independent. No runtime dependency on the others.
```

### IPC Contract: Desktop ↔ Sidecar

All communication is HTTP/JSON on `127.0.0.1:3002`. The desktop passes a shared
secret (`SIDECAR_SECRET`) as a header.

**Fast path:**

```
POST /query/fast
Body: { audio_b64: string, screenshot_b64: string, mode?: "answer" | "guide" }
Response: SSE stream → { type: "transcript" | "llm_chunk" | "audio_chunk" | "visual_guide" | "done" }
```

**Visual guide response chunk:**

```json
{
  "type": "visual_guide",
  "step": 1,
  "total_steps": 4,
  "instruction": "Click the Messages tab at the top left",
  "elements": [
    {
      "label": "Messages tab",
      "bbox": { "x": 120, "y": 45, "width": 100, "height": 30 }
    },
    {
      "label": "Unread badge",
      "bbox": { "x": 210, "y": 48, "width": 20, "height": 20 }
    }
  ]
}
```

**Agent path:**

```
POST /query/agent
Body: { audio_b64: string, screenshot_b64?: string, task: string }
Response: SSE stream → { type: "status" | "tool_call" | "output" | "done" | "error" }
```

**Health / status:**

```
GET /health → { status: "ok", version: string }
GET /status → { listening: bool, active_task?: string }
```

### IPC Contract: Sidecar ↔ Backend

```
POST /api/llm/stream
Auth: Bearer <user JWT>
Body: { model: string, messages: Message[], tools?: Tool[], stream: true }
Response: Vercel AI SDK-compatible SSE

POST /api/stt
Auth: Bearer <user JWT>
Body: { audio_b64: string }
Response: { transcript: string }

POST /api/usage
Auth: Bearer <user JWT>
Body: UsageEvent
Response: 204

POST /api/rag/search
Auth: Bearer <user JWT>
Body: { query: string, limit?: number }
Response: { snippets: RagSearchResult[] }
```

### Port Assignments

| Service        | Port | Protocol                    |
| -------------- | ---- | --------------------------- |
| `apps/landing` | 3000 | HTTP (Next.js dev server)   |
| `apps/backend` | 3001 | HTTP (Hono)                 |
| `apps/sidecar` | 3002 | HTTP (Hono, localhost only) |
| `apps/desktop` | —    | Electron (IPC to sidecar)   |

### Data Flow: Fast Path

```
[Hotkey press]
  → Desktop captures mic stream + screenshot (parallel)
  → POST /query/fast to sidecar (audio + screenshot)
    → Sidecar: Sarvam STT (`saarika:v2.5`)
    → Sidecar: structured local memory + local RAG archive context
    → Sidecar: Vercel AI SDK streamText (cached system prompt + context)
    → Sidecar: Sarvam TTS (`bulbul:v3`)
  → Desktop receives audio_chunk stream → plays audio
Total budget: < 2s to first audio byte
```

### Data Flow: Agent Path

```
[User trigger "Yomi agent, ..."]
  → Intent router returns `agent`
  → POST /query/agent to sidecar
    → Sidecar starts ReAct loop
    → Per tool call: PreToolUse hook → execute → PostToolUse hook
    → Agent writes steps to ~/.yomi/projects/<task>/scratchpad.md
    → Desktop shows streaming status in floating UI
  → On completion: Stop hook persists memory, flushes scratchpad
```

## Files to change

- `packages/shared/src/index.ts` — IPC type definitions (SseEvent,
  FastQueryRequest, AgentQueryRequest)
- `apps/desktop/src/main/ipc.ts` — IPC bridge implementation

## Files to create

- None — architecture is defined across existing files

## Open Questions

- WebSocket vs SSE for the sidecar IPC: SSE is simpler and sufficient; WebSocket
  if bidirectional control (pause/cancel) is needed mid-stream.
- Sidecar crash recovery: desktop should restart the sidecar process if health
  check fails.
