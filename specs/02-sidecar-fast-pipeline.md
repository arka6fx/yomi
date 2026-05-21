# Spec 02 — Sidecar: Fast Pipeline

## Purpose

Define the fast linear pipeline (STT → LLM → TTS → SSE), visual guidance mode, and prompt caching strategy. This is the hot path — every quick ask flows through here with a < 2s budget.

## Invariants

- The fast path never enters a tool-selection loop. It makes exactly one LLM call.
- The speculative screenshot is grabbed at hotkey press, not after VAD fires (~200ms savings).
- TTS streaming begins on the first sentence boundary — the user hears audio before the LLM finishes.

## Detailed Design

### Fast Pipeline

```
ElevenLabs STT (streaming)
  ↓  partial transcripts feed the LLM before VAD fires
Speculative screenshot (grabbed at hotkey press, parallel to STT)
  ↓
Vercel AI SDK streamText
  model: FAST_PATH_MODEL (default: claude-haiku-4-5-20251001)
  system: cached system prompt + yomi.md
  messages: [{ role: "user", content: [text, image_url] }]
  maxTokens: 800
  ↓
ElevenLabs TTS streaming
  ↓
SSE audio_chunk stream to desktop
```

**Prompt caching:** The system prompt + `yomi.md` content are placed before the first user message to hit Anthropic's cache. Every fast-path call pays only for the new tokens.

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

### Prompt Caching — Correct Pattern

The Vercel AI SDK `streamText` `system:` string parameter cannot carry `providerOptions`, so caching must be applied via the `messages` array:

```ts
import { createAnthropic } from "@ai-sdk/anthropic"

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = process.env.FAST_PATH_MODEL || "claude-haiku-4-5-20251001"

streamText({
  model: anthropic(MODEL),
  messages: [
    {
      role: "system",
      content: [{
        type: "text",
        text: SYSTEM_PROMPT,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      }],
    },
    { role: "user", content },
  ],
  maxTokens: 800,
})
```

Cache hits require the same model + same system prompt text across calls. Haiku requires ≥1024 tokens to cache; pad the system prompt with `yomi.md` context to meet the threshold. First call pays full cost; subsequent calls with the same system prompt pay only for new tokens.

### LLM Provider

**Primary:** `createAnthropic` with `claude-haiku-4-5-20251001`. Set `ANTHROPIC_API_KEY` to use direct Anthropic.

**Fallback / dev testing:** Set `OPENROUTER_API_KEY` + `LLM_BASE_URL=https://openrouter.ai/api/v1` to route through OpenRouter via `@ai-sdk/openai` with a custom base URL. This lets you test any model before committing to a direct provider subscription. When `LLM_BASE_URL` is set, the pipeline uses `createOpenAI({ baseURL: LLM_BASE_URL })` instead of `createAnthropic`.

```ts
const model = process.env.LLM_BASE_URL
  ? createOpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: process.env.LLM_BASE_URL })(MODEL)
  : createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(MODEL)
```

Default model: `FAST_PATH_MODEL || "claude-haiku-4-5-20251001"`. Prompt caching only applies when using Anthropic directly — OpenRouter does not support `cacheControl`.

### STT Provider

**Primary (cloud):** ElevenLabs STT — `POST /v1/speech-to-text`, model `scribe_v1`. Requires `ELEVENLABS_API_KEY`.

**Fallback (local/offline):** `whisper.cpp` — bundled with the desktop app, runs on-device. Activated when `ELEVENLABS_API_KEY` is absent or when the user enables "local mode" in settings. Latency is higher (~500ms on CPU) but works without internet. See spec 05 for the full STT provider abstraction.

### TTS Provider

**Primary:** ElevenLabs TTS streaming — `POST /v1/text-to-speech/:voice_id/stream`, model `eleven_flash_v2_5`. Streams MP3 chunks; the desktop begins playback before generation completes.

**Fallbacks:**
- `edge-tts` — Microsoft Edge cloud TTS, free, no API key. Lower quality but zero cost.
- `Piper` — fully local neural TTS, bundled with the app. Works offline. See spec 06 for the full TTS provider abstraction.

## Files to change

- `apps/sidecar/src/index.ts` — Hono server entry point, route registration
- `apps/sidecar/src/pipeline/fast.ts` — Switch from `createOpenAI`/OpenRouter to `createAnthropic` + caching
- `apps/sidecar/src/pipeline/visual-guide.ts` — Same model switch
- `packages/shared/src/index.ts` — IPC type definitions

## Files to create

_(already created in the sidecar-fast-pipeline PR — listed for reference)_
- `apps/sidecar/src/pipeline/fast.ts`
- `apps/sidecar/src/pipeline/visual-guide.ts`

## Open Questions

- Sentence-boundary detection for TTS: `. ` and `\n` are good defaults, but mid-sentence pauses (commas, clauses) may improve perceived naturalness.
- Streaming TTS: `audio_chunk` SSE event type is defined in shared types but ElevenLabs TTS integration is not yet wired in the sidecar. TTS streaming is a follow-on task.
