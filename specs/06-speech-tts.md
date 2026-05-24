# Spec 06 - Speech: TTS

## Purpose

Define the text-to-speech pipeline using Sarvam `bulbul:v3`. TTS starts on sentence boundaries so audio begins before the full LLM response is generated.

## Invariants

- TTS synthesis begins on the first sentence boundary; never wait for the full LLM response.
- Sarvam `bulbul:v3` is the TTS provider.
- Audio output is 16 kHz to match renderer playback.
- Voice defaults to `shreya` and can be overridden with `SARVAM_VOICE`.
- Set `TTS_ENGINE=none` to disable voice output.

## Detailed Design

### TTS: Sarvam

```typescript
const audios = await sarvamSynthesize([text], {
  model: "bulbul:v3",
  speaker: process.env.SARVAM_VOICE ?? "shreya",
  speech_sample_rate: 16000,
})
```

### Provider Selection

```typescript
type TtsEngine = "sarvam" | "none"

function resolveTts(): TtsEngine {
  if (process.env.TTS_ENGINE === "none") return "none"
  if (process.env.SARVAM_API_KEY) return "sarvam"
  return "none"
}
```

### Sentence-Boundary TTS

The fast pipeline streams `llm_chunk` events. TTS buffers text chunks, flushes at sentence boundaries, synthesizes each sentence, and emits `audio_chunk` SSE events alongside text.

```typescript
let buffer = ""
for await (const chunk of result.textStream) {
  buffer += chunk
  const sentenceEnd = buffer.search(/[.!?]\s/)
  if (sentenceEnd > -1) {
    const sentence = buffer.slice(0, sentenceEnd + 1)
    buffer = buffer.slice(sentenceEnd + 2)
    queueTts(sentence)
  }
}
if (buffer.trim().length > 0) queueTts(buffer)
```

## Files

- `apps/sidecar/src/speech/resolver.ts` - provider selection and synthesis dispatch.
- `apps/sidecar/src/services/sarvam/tts.ts` - Sarvam TTS client.
- `apps/sidecar/src/pipeline/fast.ts` - sentence-boundary buffering and `audio_chunk` SSE.
- `apps/sidecar/src/pipeline/fast.test.ts` - tests for sentence-boundary audio events.

## Open Questions

- Sarvam returns WAV bytes today. If the renderer changes playback format, add conversion at the edge.
