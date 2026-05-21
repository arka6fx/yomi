# Spec 08 — Speech (STT + TTS)

## Purpose

Define the STT and TTS pipeline using ElevenLabs as the primary provider, whisper.cpp as the offline fallback, and the latency optimisations that keep the fast path under 2 seconds.

## Invariants

- The fast path budget is < 2s from hotkey press to first audio byte.
- ElevenLabs is the default cloud provider for both STT and TTS.
- whisper.cpp (local) is the offline STT fallback — must work with no internet and no API key.
- Piper TTS (local) is the offline TTS fallback — must work with no internet and no API key.
- edge-tts (free cloud) is the free TTS option — needs internet, no API key required.
- VAD (voice activity detection) determines end-of-speech — never a fixed timeout.
- TTS streams: audio playback begins before the full LLM response is generated.

## Detailed Design

### STT: ElevenLabs

```typescript
import { ElevenLabsClient } from "elevenlabs"
const eleven = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY })

// Streaming STT — partial transcripts feed the LLM before VAD fires
const stream = await eleven.speechToText.convertAsStream({
  audio: micStream,           // ReadableStream<Buffer> of PCM chunks
  model_id: "scribe_v1",
  language_code: "en",        // auto-detect if not set
})

for await (const chunk of stream) {
  if (chunk.type === "interim_results") {
    speculativeTranscript = chunk.alternatives[0].transcript
    // Feed interim transcript to LLM immediately — don't wait for final
  }
  if (chunk.type === "final_results") {
    finalTranscript = chunk.alternatives[0].transcript
    break
  }
}
```

**VAD:** use the WebRTC VAD (via `@ricky0123/vad-node` or similar) to detect end-of-speech. Do not wait for a fixed 1–2s silence — VAD fires in ~50ms of silence after speech ends.

### STT: whisper.cpp (offline fallback)

```typescript
// Invoked when ELEVENLABS_API_KEY is not set, or when user enables offline mode
import { whisper } from "@pr0gramm/whisper"   // or whispercpp node binding

const result = await whisper({
  model: "base.en",    // ~75MB, fast, good enough for most speech
  audio: pcmBuffer,
  language: "en",
})
```

**Model selection:**
- `tiny.en` (~39MB) — fastest, < 500ms, lower accuracy
- `base.en` (~75MB) — default, ~700ms, good accuracy
- `small.en` (~244MB) — best offline accuracy, ~1.5s

Ship `base.en` in the app bundle. `small.en` available as an opt-in download.

### TTS: ElevenLabs (streaming)

```typescript
const audioStream = await eleven.textToSpeech.stream(VOICE_ID, {
  text: llmResponse,
  model_id: "eleven_turbo_v2",  // lowest latency ElevenLabs model
  voice_settings: {
    stability: 0.5,
    similarity_boost: 0.75,
  },
  output_format: "mp3_22050_32",  // small file size, good quality
})

// Pipe directly to audio player — first chunk plays while rest streams
for await (const chunk of audioStream) {
  audioPlayer.push(chunk)
}
```

**Voice:** default is `Rachel` (ElevenLabs voice ID: `21m00Tcm4TlvDq8ikWAM`). User can override with `tts_voice_id` in `yomi.md`.

### TTS: Piper (offline fallback)

```typescript
// Invoked when ELEVENLABS_API_KEY is not set and PIPER_TTS_VOICE is configured
import { spawn } from "child_process"

function synthesizePiper(text: string, voice: string): ReadableStream {
  // piper writes raw PCM to stdout, reads text from stdin
  const proc = spawn("piper", [
    "--model", voice,           // e.g. /usr/share/piper/voices/en_US-lessac-medium.onnx
    "--output-raw",
    "--sentence-silence", "0.2",
  ])
  proc.stdin.write(text + "\n")
  proc.stdin.end()
  return proc.stdout             // 16kHz mono PCM audio — pipe to audio player
}
```

**Installation:** `apt install piper-tts` (Debian/Ubuntu) or download model from [Piper's GitHub releases](https://github.com/rhasspy/piper/releases). Models are ~2–50MB.

**Voice config:** set `tts_engine: piper` and `piper_voice: /path/to/voice.onnx` in `yomi.md`. Default voice: `en_US-lessac-medium`.

**Limitations:**
- No streaming (generates full audio then plays) — adds ~500ms to latency for short responses
- Raw PCM output — needs `ffplay` / `aplay` / PipeWire for playback
- Robotic quality compared to ElevenLabs, but fully offline and free

### TTS: edge-tts (free cloud)

```typescript
// Free Microsoft neural TTS — needs internet but no API key
import { spawn } from "child_process"

function synthesizeEdgeTts(text: string, voice: string): ReadableStream {
  const proc = spawn("edge-tts", [
    "--text", text,
    "--voice", voice,           // e.g. en-US-JennyNeural
    "--write-media", "/dev/stdout",
    "--write-subtitles", "/dev/null",
  ])
  return proc.stdout             // MP3 audio stream — pipe directly to audio player
}
```

**Installation:** `pip install edge-tts` (requires Python 3.9+). No API key, no account.

**Voice config:** set `tts_engine: edge-tts` and `edge_tts_voice: en-US-JennyNeural` in `yomi.md`. [Full voice list](https://github.com/rany2/edge-tts?tab=readme-ov-file#text-to-speech).

**Advantages:**
- Streaming-capable (`edge-tts` streams MP3 as it generates)
- Natural neural voice quality (Microsoft's TTS) — close to ElevenLabs quality
- Wide language/locale support
- No rate limits (Microsoft's free tier is generous)
- MP3 output — no extra conversion needed for audio playback

### TTS: provider selection

The sidecar resolves TTS at startup based on config:

```typescript
type TtsEngine = "elevenlabs" | "edge-tts" | "piper"

function resolveTts(): TtsEngine {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs"
  if (process.env.TTS_ENGINE === "edge-tts") return "edge-tts"
  return "piper"   // last resort — fully offline
}
```

### Latency Budget (fast path)

| Step | Target | Technique |
|---|---|---|
| Hotkey → mic starts | < 20ms | Pre-init audio context on app start |
| Speech → VAD fires | < 50ms after silence | WebRTC VAD |
| VAD → ElevenLabs STT final | < 400ms | Streaming, parallel to LLM start |
| Speculative screenshot | 0ms (parallel) | Grab at hotkey press, not after VAD |
| LLM first token | < 300ms | Prompt cache hit; haiku model |
| LLM → TTS first chunk | < 200ms | Start TTS as soon as first sentence token appears |
| TTS first audio byte | < 100ms | ElevenLabs turbo model, streaming |
| **Total to first audio** | **< 1.2s** | All steps overlap |
>
> **Fallback latency (no ElevenLabs):**
>
> | Step | Target | Note |
> |---|---|---|
> | Whisper STT (base.en) | ~700ms | Local CPU, no network |
> | LLM first token | < 500ms | OpenRouter free model |
> | edge-tts first byte | < 500ms | Free cloud, streaming MP3 |
> | Piper TTS (offline) | ~1s after LLM | Non-streaming, raw PCM |
> | **Total (edge-tts)** | **< 2s** | Still within Phase 0 tolerance |
> | **Total (Piper)** | **~3s** | Acceptable for offline/dev mode |

**Speculative screenshot:** the screen is captured the instant push-to-talk is pressed, in parallel with mic capture and STT. This saves ~200ms vs waiting for the transcript.

**Sentence-boundary TTS:** don't wait for the full LLM response. Start TTS when the first sentence boundary is detected (`. ` or `\n`). Play audio while the rest streams.

```typescript
let buffer = ""
for await (const chunk of llmStream) {
  buffer += chunk.text
  const sentenceEnd = buffer.search(/[.!?]\s/)
  if (sentenceEnd > -1) {
    const sentence = buffer.slice(0, sentenceEnd + 1)
    buffer = buffer.slice(sentenceEnd + 2)
    queueTts(sentence)   // non-blocking — feeds TTS stream
  }
}
if (buffer.length > 0) queueTts(buffer)
```

### Vercel AI SDK Integration

Both the sidecar and backend use the `ai` package uniformly:

```typescript
// apps/sidecar/src/pipeline/fast.ts
import { streamText } from "ai"
import { anthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

// Provider resolved from env at startup
const model = process.env.LLM_BASE_URL
  ? createOpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.OPENROUTER_API_KEY })(
      process.env.FAST_PATH_MODEL ?? "anthropic/claude-haiku-4-5"
    )
  : anthropic(process.env.FAST_PATH_MODEL ?? "claude-haiku-4-5-20251001")

export async function runFastPipeline(transcript: string, screenshot: Buffer) {
  const result = await streamText({
    model,
    system: CACHED_SYSTEM_PROMPT,   // cache prefix — must not change turn-to-turn
    messages: [
      { role: "user", content: [
        { type: "text", text: transcript },
        { type: "image", image: screenshot },
      ]},
    ],
    maxTokens: 800,
    experimental_providerMetadata: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  })
  return result
}
```

**OpenRouter testing:** set `OPENROUTER_API_KEY` and `LLM_BASE_URL=https://openrouter.ai/api/v1` in `.env`. No other code changes needed. Any model available on OpenRouter works, including free-tier models for development.

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — STT + TTS integration in fast pipeline

## Files to create

- `apps/sidecar/src/speech/stt-elevenlabs.ts` — ElevenLabs STT streaming client
- `apps/sidecar/src/speech/stt-whisper.ts` — whisper.cpp local fallback
- `apps/sidecar/src/speech/tts-elevenlabs.ts` — ElevenLabs TTS streaming
- `apps/sidecar/src/speech/tts-piper.ts` — Piper TTS offline fallback
- `apps/sidecar/src/speech/tts-edge.ts` — edge-tts free cloud TTS
- `apps/sidecar/src/speech/resolver.ts` — Provider selection logic
- `apps/sidecar/src/speech/vad.ts` — WebRTC VAD for end-of-speech detection

## Open Questions

- ElevenLabs STT language auto-detection: test accuracy on non-English before deciding whether to always set `language_code`.
- Audio format: PCM 16kHz mono is ideal for Whisper STT; ElevenLabs accepts various formats. Standardise on PCM 16kHz internally.
- edge-tts license implications: verify Microsoft's terms for commercial use before Phase 3 launch.
