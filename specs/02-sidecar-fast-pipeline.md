# Spec 02 - Sidecar Fast Pipeline

## Purpose

Define the fast linear pipeline, context assembly, visual guidance mode, and
model configuration. This is the hot path: every quick ask should stay near the
two second budget when external providers respond quickly.

## Invariants

- The fast path never enters a tool-selection loop.
- The intent router decides fast vs agent before pipeline execution.
- Screenshot capture happens in desktop before the sidecar request.
- Screenshots are attached to the model only when the query appears
  screen-aware.
- Pro/Max context retrieval happens before the single answer LLM call.
- Local RAG retrieval is optional and non-fatal.
- TTS starts on sentence boundaries so the user hears audio before the LLM
  finishes.

## Fast Pipeline

```text
text input or ElevenLabs STT
  -> screen-aware screenshot inclusion check
  -> Pro/Max context assembly
       local memory profiles + FTS snippets
       recent session tail
       local RAG snippets from Yomi memory files
  -> Vercel AI SDK streamText
       model: OPENAI_FAST_MODEL || gpt-5.4-mini
       provider: @ai-sdk/openai via OpenAI-compatible endpoint
  -> optional ElevenLabs TTS
  -> SSE events to desktop
```

Explore skips local memory and local RAG context. Pro and Max load local memory
plus local RAG snippets.

## Request Contract

```ts
interface FastQueryRequest {
  text?: string
  audio_b64?: string
  screenshot_b64?: string
  mode?: "answer" | "guide"
  tts?: boolean
  plan?: "explore" | "pro" | "max"
  history?: { role: "user" | "assistant"; text: string }[]
}
```

## Screen Context

The sidecar runs a local heuristic over the resolved text. It includes the
screenshot only for screen/UI/image/spatial queries such as "what is this
error?" or "what is on my screen?" Self-contained knowledge and writing requests
do not include the screenshot.

## Context Assembly

For Pro/Max answer mode, `getFastPrompt` loads:

- `yomi.md`
- static/dynamic local memory profiles
- local SQLite FTS memory snippets
- capped legacy `memory.md` / `memory-index.md`
- recent session tail
- local RAG snippets from `~/.yomi/sessions`, `~/.yomi/projects`, and
  non-profile `~/.yomi/memory` files

If local RAG retrieval fails, the request continues with structured local memory
only.

## Visual Guidance Mode

Guide mode returns structured visual guide steps:

```ts
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

If visual targets cannot be identified, emit a text-only guide step with
`elements: []`.

## Speech Providers

- STT: ElevenLabs `scribe_v2`
- TTS: ElevenLabs `eleven_flash_v2_5`
- Disable TTS with `TTS_ENGINE=none`

## Implemented Files

- `apps/sidecar/src/index.ts`
- `apps/sidecar/src/pipeline/fast.ts`
- `apps/sidecar/src/pipeline/model.ts`
- `apps/sidecar/src/pipeline/tts.ts`
- `apps/sidecar/src/pipeline/visual-guide.ts`
- `apps/sidecar/src/memory/engine.ts`
- `apps/sidecar/src/memory/local-rag.ts`
- `packages/shared/src/index.ts`

## Future Work

- Better screenshot relevance evaluation.
- Local semantic embeddings for memory retrieval beyond FTS.
- More nuanced output budgets by request type.
