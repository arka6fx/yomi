# Spec 05 — Speech: STT

## Purpose

Define the speech-to-text pipeline using OpenAI Whisper as the primary cloud provider. Local whisper.cpp fallback is removed — all STT goes through OpenAI.

## Invariants

- OpenAI Whisper (`whisper-1`) is the only cloud STT provider.
- VAD (voice activity detection) determines end-of-speech — never a fixed timeout.
- Audio format: PCM 16kHz mono internal standard, converted as needed per provider.
- Requires `OPENAI_API_KEY`.

## Detailed Design

### STT: OpenAI Whisper

```typescript
const transcript = await openai.audio.transcriptions.create({
  model: process.env.STT_MODEL || "whisper-1",
  file: await toFile(wavBuffer, "audio.wav"),
})
```

### VAD (Voice Activity Detection)

Use WebRTC VAD to detect end-of-speech. Do not use a fixed timeout — VAD fires in ~50ms of silence after speech ends.

### Latency Budget (STT portion)

| Step | Target | Technique |
|---|---|---|
| Hotkey → mic starts | < 20ms | Pre-init audio context on app start |
| Speech → VAD fires | < 50ms after silence | WebRTC VAD |
| VAD → Whisper STT final | < 500ms | OpenAI API, streaming not required |

## Files to create

- `apps/sidecar/src/speech/transcribe.ts` — OpenAI Whisper STT
- `apps/sidecar/src/speech/vad.ts` — WebRTC VAD for end-of-speech detection

## Files to change

- `apps/sidecar/src/pipeline/fast.ts` — integrate STT into fast pipeline

## Open Questions

- Audio format: PCM 16kHz mono is standard. OpenAI Whisper accepts various formats.
