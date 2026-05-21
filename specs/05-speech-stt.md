# Spec 04 — Speech: STT

## Purpose

Define the speech-to-text pipeline using ElevenLabs as the primary cloud provider and whisper.cpp as the offline fallback. Delivers streaming partial transcripts that feed the LLM before VAD fires.

## Invariants

- ElevenLabs is the default cloud STT provider.
- whisper.cpp (local) is the offline STT fallback — must work with no internet and no API key.
- VAD (voice activity detection) determines end-of-speech — never a fixed timeout.
- Audio format: PCM 16kHz mono internal standard, converted as needed per provider.

## Detailed Design

### STT: ElevenLabs

```typescript
import { ElevenLabsClient } from "elevenlabs"
const eleven = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY })

const stream = await eleven.speechToText.convertAsStream({
  audio: micStream,
  model_id: "scribe_v1",
  language_code: "en",
})

for await (const chunk of stream) {
  if (chunk.type === "interim_results") {
    speculativeTranscript = chunk.alternatives[0].transcript
    // Feed to LLM immediately — don't wait for final
  }
  if (chunk.type === "final_results") {
    finalTranscript = chunk.alternatives[0].transcript
    break
  }
}
```

### STT: whisper.cpp (offline fallback)

```typescript
const result = await whisper({
  model: "base.en",
  audio: pcmBuffer,
  language: "en",
})
```

**Model selection:**
- `tiny.en` (~39MB) — fastest, < 500ms, lower accuracy
- `base.en` (~75MB) — default, ~700ms, good accuracy
- `small.en` (~244MB) — best offline accuracy, ~1.5s

Ship `base.en` in the app bundle. `small.en` available as opt-in download.

### VAD (Voice Activity Detection)

Use WebRTC VAD (via `@ricky0123/vad-node` or similar) to detect end-of-speech. Do not use a fixed timeout — VAD fires in ~50ms of silence after speech ends.

### Latency Budget (STT portion)

| Step | Target | Technique |
|---|---|---|
| Hotkey → mic starts | < 20ms | Pre-init audio context on app start |
| Speech → VAD fires | < 50ms after silence | WebRTC VAD |
| VAD → ElevenLabs STT final | < 400ms | Streaming, parallel to LLM start |
| Whisper STT (base.en) | ~700ms | Local CPU, no network |

## Files to create

- `apps/sidecar/src/speech/stt-elevenlabs.ts` — ElevenLabs STT streaming client
- `apps/sidecar/src/speech/stt-whisper.ts` — whisper.cpp local fallback
- `apps/sidecar/src/speech/vad.ts` — WebRTC VAD for end-of-speech detection

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — integrate STT into fast pipeline

## Open Questions

- ElevenLabs STT language auto-detection: test accuracy on non-English before deciding whether to always set `language_code`.
- Audio format: PCM 16kHz mono is ideal for Whisper STT; ElevenLabs accepts various formats. Standardise on PCM 16kHz internally.
