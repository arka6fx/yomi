# Spec 02 — Sidecar: Fast Pipeline

## Purpose

Define the fast linear pipeline (STT → LLM → TTS → SSE), visual guidance mode, and model configuration. This is the hot path — every quick ask flows through here with a < 2s budget.

## Invariants

- The fast path never enters a tool-selection loop. It makes exactly one LLM call.
- The speculative screenshot is grabbed at hotkey press, not after VAD fires (~200ms savings).
- TTS streaming begins on the first sentence boundary — the user hears audio before the LLM finishes.

## Detailed Design

### Fast Pipeline

```
OpenAI Whisper STT
  ↓
Speculative screenshot (grabbed at hotkey press, parallel to STT)
  ↓
Vercel AI SDK streamText
  model: FAST_PATH_MODEL (default: gpt-4.1-mini)
  system: cached system prompt + yomi.md
  messages: [{ role: "user", content: [text, image_url] }]
  maxTokens: 800
  ↓
OpenAI TTS streaming
  ↓
SSE audio_chunk stream to desktop
```

### Visual Guidance Mode

When the user asks for step-by-step guidance ("show me how to...", "guide me through..."), the fast path runs in `guide` mode. It produces a visual overlay on the user's screen with arrows and labels pointing to UI elements.

**Flow:**
```
1. User: "guide me through sending a message in Discord"
2. Screenshot captured (current state of the app)
3. LLM call with structured output schema:
   {
     steps: [
       {
         instruction: string,
         elements: {
           label: string,
           bbox: { x, y, width, height }
         }[]
       }
     ]
   }
4. Sidecar emits SSE visual_guide chunks, one per step
5. Desktop renders a transparent overlay with arrows/labels at each bbox
6. User presses Next/Prev to step through
```

**LLM prompt guide mode:** append to the system prompt:
```
You are in guide mode. The user wants you to show them how to do something step by step.
For each step, return:
- instruction: a short instruction the user can follow
- elements: UI elements from the screenshot to highlight, with bounding box coordinates

Keep instructions to 1 sentence. Highlight only the relevant UI element per step.
```

**Fallback:** if the LLM cannot identify UI elements, fall back to text-only instructions. Emit `visual_guide` with `elements: []`. The desktop shows just the text step.

**Speculative screenshot:** grabbed the instant push-to-talk starts, not after VAD fires. This means vision context is ready when the transcript lands. ~200ms savings.

### LLM Provider

All AI routing uses OpenAI models via `@ai-sdk/openai`. Set `OPENAI_API_KEY` to use. Optional: `OPENAI_BASE_URL` for custom endpoints.

```ts
import { createOpenAI } from "@ai-sdk/openai"

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

export function createModel(modelId: string) {
  return openai(modelId)
}
```

Default model: `FAST_PATH_MODEL || "gpt-4.1-mini"`.

### STT Provider

**Primary:** OpenAI Whisper (`whisper-1`) via the OpenAI SDK. Requires `OPENAI_API_KEY`.

### TTS Provider

**Primary:** OpenAI TTS (`gpt-4o-mini-tts`) via the OpenAI SDK. Uses Alloy voice by default. Configurable via `TTS_MODEL` and `TTS_ENGINE` env vars.

## Files to change

- `apps/sidecar/src/index.ts` — Hono server entry point, route registration
- `apps/sidecar/src/pipeline/fast.ts` — Pipeline implementation
- `apps/sidecar/src/pipeline/visual-guide.ts` — Visual guide implementation
- `packages/shared/src/index.ts` — IPC type definitions

## Files to create

_(already created — listed for reference)_
- `apps/sidecar/src/pipeline/fast.ts`
- `apps/sidecar/src/pipeline/visual-guide.ts`

## Open Questions

- Sentence-boundary detection for TTS: `. ` and `\n` are good defaults, but mid-sentence pauses (commas, clauses) may improve perceived naturalness.
