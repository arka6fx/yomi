# Spec 06 — Speech: TTS

## Purpose

Define the text-to-speech pipeline using OpenAI TTS as the sole provider. TTS streams so audio begins before the full LLM response is generated.

## Invariants

- TTS streaming begins on the first sentence boundary — never wait for the full LLM response.
- OpenAI TTS is the only provider (model: `gpt-4o-mini-tts`).
- Voice is user-overridable via `yomi.md` or `TTS_MODEL` env var.

## Detailed Design

### TTS: OpenAI

```typescript
const resp = await openai.audio.speech.create({
  model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
  voice: "alloy",
  input: text,
  response_format: "mp3",
})
```

**Voice:** default is `alloy`. User can override via `tts_voice` in `yomi.md`.

### Provider Selection

```typescript
type TtsEngine = "openai" | "none"

function resolveTts(): TtsEngine {
  if (process.env.OPENAI_API_KEY) return "openai"
  return "none"
}
```

### Sentence-Boundary TTS

The fast pipeline (`apps/sidecar/src/pipeline/fast.ts`) streams `llm_chunk` events. TTS hooks in between the existing `result.textStream` loop and the `llm_chunk` yield: buffer chunks, flush at each sentence boundary into TTS, and emit the resulting audio as `audio_chunk` SSE events.

```typescript
let buffer = ""
for await (const chunk of llmStream) {
  buffer += chunk.text
  const sentenceEnd = buffer.search(/[.!?]\s/)
  if (sentenceEnd > -1) {
    const sentence = buffer.slice(0, sentenceEnd + 1)
    buffer = buffer.slice(sentenceEnd + 2)
    queueTts(sentence)
  }
}
if (buffer.length > 0) queueTts(buffer)
```

### Latency Budget (TTS portion)

| Step | Target | Note |
|---|---|---|
| LLM → TTS first chunk | < 200ms | Start TTS on first sentence token |
| OpenAI TTS first byte | < 300ms | Cloud streaming |

## Files to create

- `apps/sidecar/src/speech/resolver.ts` — Provider selection + OpenAI TTS synthesis

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — sentence-boundary buffer around the existing `textStream` loop in `answerPipeline`; emit `audio_chunk` events alongside `llm_chunk`
- `apps/sidecar/src/pipeline/fast.test.ts` — extend mocks to assert TTS chunks are yielded on sentence boundaries

## Open Questions

- Audio output format: MP3 for OpenAI TTS, converted in audio player.
