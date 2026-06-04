# Spec 05 - Speech: STT

## Purpose

Define the speech-to-text pipeline using ElevenLabs `scribe_v2` as the cloud
provider.

## Invariants

- ElevenLabs `scribe_v2` is the cloud STT provider.
- VAD determines end-of-speech; never use a fixed timeout.
- Audio format: WAV / PCM 16 kHz mono internal standard.
- Requires `ELEVENLABS_API_KEY`.

## Detailed Design

### STT: ElevenLabs

```typescript
const result = await elevenLabsTranscribe(wavBytes, {
  model_id: "scribe_v2",
})
const transcript = result.text
```

### VAD

Use local voice activity detection to detect end-of-speech. Do not use a fixed
timeout. VAD should fire shortly after silence following speech.

### Latency Budget

| Step                 | Target                | Technique                           |
| -------------------- | --------------------- | ----------------------------------- |
| Hotkey to mic starts | < 20 ms               | Pre-init audio context on app start |
| Speech to VAD fires  | < 50 ms after silence | Local VAD                           |
| VAD to STT final     | < 500 ms              | ElevenLabs API                      |

## Files

- `apps/sidecar/src/speech/transcribe.ts` - ElevenLabs STT wrapper.
- `apps/sidecar/src/services/elevenlabs/stt.ts` - ElevenLabs HTTP client.
- `apps/sidecar/src/speech/vad.ts` - local VAD helpers.
- `apps/sidecar/src/pipeline/fast.ts` - integrates STT into the fast pipeline.

## Open Questions

- Offline fallback is not part of the current implementation.
