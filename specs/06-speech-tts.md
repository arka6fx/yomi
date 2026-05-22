# Spec 06 — Speech: TTS

## Purpose

Define the text-to-speech pipeline with three tiers: ElevenLabs (cloud, premium), edge-tts (free cloud), and Piper (offline). TTS streams so audio begins before the full LLM response is generated.

## Invariants

- TTS streaming begins on the first sentence boundary — never wait for the full LLM response.
- ElevenLabs is the default TTS provider when an API key is set.
- Piper TTS is the offline fallback (no network, no key required).
- edge-tts is the free cloud option (network required, no key).
- Voice config is user-overridable via `yomi.md`.

## Detailed Design

### TTS: ElevenLabs (streaming)

```typescript
const audioStream = await eleven.textToSpeech.stream(VOICE_ID, {
  text: llmResponse,
  model_id: "eleven_turbo_v2",
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75,
  },
  output_format: "mp3_22050_32",
})

for await (const chunk of audioStream) {
  audioPlayer.push(chunk)
}
```

**Voice:** default is `Rachel` (ElevenLabs voice ID: `21m00Tcm4TlvDq8ikWAM`). User can override with `tts_voice_id` in `yomi.md`.

### TTS: Piper (offline fallback)

```typescript
function synthesizePiper(text: string, voice: string): ReadableStream {
  const proc = spawn("piper", [
    "--model", voice,
    "--output-raw",
    "--sentence-silence", "0.2",
  ])
  proc.stdin.write(text + "\n")
  proc.stdin.end()
  return proc.stdout
}
```

**Installation:** `apt install piper-tts` (Debian/Ubuntu) or download from Piper's GitHub releases.

**Voice config:** set `tts_engine: piper` and `piper_voice` in `yomi.md`. Default: `en_US-lessac-medium`.

**Limitations:** no streaming (full audio then play), raw PCM output, robotic quality. Acceptable for offline/dev use.

### TTS: edge-tts (free cloud)

```typescript
function synthesizeEdgeTts(text: string, voice: string): ReadableStream {
  const proc = spawn("edge-tts", [
    "--text", text,
    "--voice", voice,
    "--write-media", "/dev/stdout",
    "--write-subtitles", "/dev/null",
  ])
  return proc.stdout
}
```

**Installation:** `pip install edge-tts` (Python 3.9+). No API key.

**Voice config:** set `tts_engine: edge-tts` and `edge_tts_voice` in `yomi.md`.

**Advantages:** streaming MP3, natural neural quality, wide language support, no rate limits.

### Provider Selection

```typescript
type TtsEngine = "elevenlabs" | "edge-tts" | "piper"

function resolveTts(): TtsEngine {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  if (process.env.TTS_ENGINE === "edge-tts") return "edge-tts"
  return "piper"
}
```

### Sentence-Boundary TTS

The fast pipeline (`apps/sidecar/src/pipeline/fast.ts`) already streams `llm_chunk` events and `ANSWER_SYSTEM_PROMPT` constrains responses to 1-3 sentences. TTS hooks in between the existing `result.textStream` loop and the `llm_chunk` yield: buffer chunks, flush at each sentence boundary into `queueTts`, and emit the resulting audio as `audio_chunk` SSE events (already defined in `packages/shared/src/index.ts`).

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

`queueTts` runs synthesis for the resolved engine and yields `{ type: "audio_chunk", base64 }` for each output chunk, in parallel with the `llm_chunk` text stream so the desktop UI can render text and play audio together.

### Latency Budget (TTS portion)

| Step | Target | Note |
|---|---|---|
| LLM → TTS first chunk | < 200ms | Start TTS on first sentence token |
| ElevenLabs TTS first byte | < 100ms | Turbo model, streaming |
| edge-tts first byte | < 500ms | Free cloud, streaming MP3 |
| Piper TTS | ~1s after LLM | Non-streaming, raw PCM |

## Files to create

- `apps/sidecar/src/speech/tts-elevenlabs.ts` — ElevenLabs TTS streaming
- `apps/sidecar/src/speech/tts-piper.ts` — Piper TTS offline fallback
- `apps/sidecar/src/speech/tts-edge.ts` — edge-tts free cloud TTS
- `apps/sidecar/src/speech/resolver.ts` — Provider selection logic

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — sentence-boundary buffer around the existing `textStream` loop in `answerPipeline`; emit `audio_chunk` events alongside `llm_chunk`
- `apps/sidecar/src/pipeline/fast.test.ts` — extend mocks to assert TTS chunks are yielded on sentence boundaries

## Open Questions

- edge-tts license implications: verify Microsoft's terms for commercial use before Phase 3 launch.
- Audio output format: standardise on MP3 for cloud, raw PCM for Piper (requires conversion in audio player).
