# Spec 02 - Sidecar: Fast Pipeline

## Purpose

Define the fast linear pipeline, visual guidance mode, and model configuration. This is the hot path: every quick ask should stay near the 2 second budget.

## Invariants

- The fast path never enters a tool-selection loop. It makes exactly one LLM call.
- The intent router decides fast vs agent before pipeline execution.
- Screenshot capture should happen as early as possible in the desktop flow.
- TTS starts on the first sentence boundary so the user hears audio before the LLM finishes.

## Fast Pipeline

```text
Sarvam STT (`saarika:v2.5`)
  -> screenshot context when needed
  -> Vercel AI SDK `streamText`
     model: FAST_PATH_MODEL (default: gpt-4.1-mini)
     provider: @ai-sdk/openai via AI Credits/OpenAI-compatible endpoint
     maxTokens: 800
  -> Sarvam TTS (`bulbul:v3`, 16 kHz)
  -> SSE events to desktop
```

The sidecar includes screenshots only when the query appears screen-aware. This avoids anchoring general questions on irrelevant visual context.

## Visual Guidance Mode

When the user asks for step-by-step guidance, the fast path runs in `guide` mode and returns structured visual guide steps.

```typescript
interface GuideResponse {
  steps: {
    instruction: string
    elements: {
      label: string
      bbox: { x: number; y: number; width: number; height: number }
    }[]
  }[]
}
```

If visual targets cannot be identified, emit a text-only guide step with `elements: []`.

## LLM Provider

All LLM routing uses an OpenAI-compatible API through `@ai-sdk/openai`.

```typescript
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

## Speech Providers

- STT: Sarvam `saarika:v2.5`, configured by `SARVAM_API_KEY`.
- TTS: Sarvam `bulbul:v3`, 16 kHz, default speaker `shreya`.
- Disable TTS with `TTS_ENGINE=none`.

## Files

- `apps/sidecar/src/index.ts` - Hono server and `/query`, `/query/fast`, `/stt` routes.
- `apps/sidecar/src/pipeline/fast.ts` - fast pipeline implementation.
- `apps/sidecar/src/pipeline/visual-guide.ts` - visual guide implementation.
- `apps/sidecar/src/pipeline/model.ts` - OpenAI-compatible model factory.
- `apps/sidecar/src/services/sarvam/stt.ts` - STT client.
- `apps/sidecar/src/services/sarvam/tts.ts` - TTS client.
- `packages/shared/src/index.ts` - shared IPC/SSE contracts.

## Open Questions

- Sentence-boundary detection currently uses punctuation plus whitespace. Mid-sentence pauses may improve perceived latency later.
