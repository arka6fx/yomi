# Spec 06 - Speech: TTS

## Purpose

Define the text-to-speech pipeline using ElevenLabs `eleven_flash_v2_5`. TTS
starts on sentence boundaries so audio begins before the full LLM response is
generated.

## Invariants

- TTS synthesis begins on the first sentence boundary; never wait for the full
  LLM response.
- ElevenLabs `eleven_flash_v2_5` is the TTS provider.
- Audio output is MP3 by default and decoded in the renderer.
- Voice is configured with `ELEVENLABS_VOICE_ID`.
- Set `TTS_ENGINE=none` to disable voice output.

## Detailed Design

### TTS: ElevenLabs

```typescript
const audio = await elevenLabsSynthesize(text, {
  model_id: "eleven_flash_v2_5",
  voiceId: process.env.ELEVENLABS_VOICE_ID,
})
```

### Provider Selection

```typescript
type TtsEngine = "elevenlabs" | "none"

function resolveTts(): TtsEngine {
  if (process.env.TTS_ENGINE === "none") return "none"
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  return "none"
}
```

### Sentence-Boundary TTS

The fast pipeline streams `llm_chunk` events. TTS buffers text chunks, flushes
at sentence boundaries, synthesizes each sentence, and emits `audio_chunk` SSE
events alongside text.

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

- `apps/backend/src/routes/tts.ts` - TTS proxy endpoint.
- `apps/backend/src/services/elevenlabs/tts.ts` - ElevenLabs TTS client.

## Open Questions

- If the renderer starts consuming arbitrary streaming MP3 fragments, split
  ElevenLabs output at codec-safe boundaries or switch to PCM output.
