# Spec 26 - Voice Loop: Agent TTS, Stop Detection, Continuous Listen

## Purpose

Define the voice loop enhancements that make the hands-free voice experience
seamless: agent-path TTS synthesis, stop-command detection, and the existing
continuous-listen mechanism.

## Invariants

- Both fast and agent paths produce `audio_chunk` SSE events for TTS output.
- TTS sentence-boundary synthesis is shared logic — never duplicated between
  pipelines.
- Stop phrases end a hands-free voice loop immediately without routing to the
  LLM.
- `voiceLoop` in `hotkey.ts` governs continuous re-listen. Ctrl+Space starts
  the loop; ESC or a stop phrase ends it.
- The sidecar `SessionMachine` is not yet wired into the live pipeline; the
  desktop `hotkey.ts` / `ipc.ts` pair manages voice-loop state.
- TTS is non-fatal: if voice synthesis fails, text events are still delivered.

## Voice Loop Flow

```text
Ctrl+Space → hotkey: voiceLoop = true, transition("listening")
  → VAD capture → STT transcript
    → isStopCommand?  yes → stopVoiceLoop, endVoiceTurn  (no LLM call)
                     no  → route to fast/agent pipeline
  → pipeline streams SSE events including audio_chunk
  → done event → ipc: endVoiceTurn()
    → if voiceLoop → onLoopContinue → transition("listening") → re-listen
    → if !voiceLoop → resetToIdle()
ESC → hotkey: voiceLoop = false, transition("idle") or abort
```

## Agent-Path TTS

Previously, the agent pipeline emitted only `agent_text` events. The desktop
accumulated these in `agentTextBuf` and displayed them, but never synthesized
audio. Now the agent path produces `audio_chunk` events just like the fast path.

### Shared Module: `sentence-tts.ts`

`EventQueue` and `SentenceTts` are extracted from `fast.ts` into a shared module
so both pipelines reuse the same sentence-boundary logic, code-fence stripping,
error handling, and first-segment optimization.

```typescript
// apps/sidecar/src/pipeline/sentence-tts.ts
class EventQueue {
  push(ev: SseEvent): void
  close(): void
  drain(): AsyncGenerator<SseEvent>
}

class SentenceTts {
  constructor(queue: EventQueue, tts?: boolean)
  feedText(chunk: string, eventType?: "llm_chunk" | "agent_text"): void
  flush(): void
  drain(): Promise<void>
}
```

`feedText` emits the text event immediately (as `llm_chunk` or `agent_text`)
and buffers for TTS. Audio is synthesized concurrently at sentence boundaries
and enqueued in order via an `audioChain` promise sequence.

### Agent Pipeline Changes

The agent pipeline's main `streamText` loop now uses `EventQueue` +
`SentenceTts` instead of direct `yield`. Events are produced by an async
`producer` function and consumed from the queue:

```typescript
const queue = new EventQueue()
const ttsAccum = new SentenceTts(queue, req.tts !== false)

const producer = (async () => {
  for await (const event of result.fullStream) {
    if (event.type === "text-delta") ttsAccum.feedText(event.textDelta, "agent_text")
    if (event.type === "tool-call") queue.push(...)
    // ...
  }
  ttsAccum.flush()
  await ttsAccum.drain()
  queue.push({ type: "done" })
  queue.close()
})()

yield* queue.drain()
```

Shortcut paths (Spotify, volume, notepad) yield a complete `agent_text` event,
then `yield* synthesizeChunks(output)` for TTS:

```typescript
async function* synthesizeChunks(text: string): AsyncGenerator<SseEvent> {
  if (resolveTts() === "none") return
  try {
    for await (const chunk of synthesize(text.trim())) {
      yield { type: "audio_chunk", base64: Buffer.from(chunk).toString("base64") }
    }
  } catch { /* TTS failure is non-fatal */ }
}
```

### Request Contract Addition

`AgentQueryRequest` gains an optional `tts` field (default `true`):

```typescript
interface AgentQueryRequest {
  text: string
  screenshot_b64?: string
  plan?: Plan
  history?: { role: "user" | "assistant"; text: string }[]
  tts?: boolean  // true (default) = synthesize audio for agent text
}
```

## Stop-Command Detection

When a hands-free voice loop is active and the STT transcript matches a stop
phrase, the desktop ends the loop immediately without calling the LLM.

### Stop Phrases

```typescript
const STOP_PHRASES = [
  "stop", "never mind", "nevermind", "cancel", "that's all",
  "thats all", "forget it", "forget this", "never mind that",
  "quit", "done talking", "i'm done", "im done", "end",
]

function isStopCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "")
  return STOP_PHRASES.some(
    phrase => t === phrase || t === `${phrase} please` || t === `${phrase} yomi`
  )
}
```

### IPC Integration

In `ipc.ts`, after STT produces a non-empty transcript:

```typescript
if (isVoiceLoopActive() && isStopCommand(transcript)) {
  stopVoiceLoop()
  send(overlayWin, { type: "transcript", text: transcript.trim() })
  endVoiceTurn()
  return
}
```

The transcript event is still sent so the UI shows what was heard, but no LLM
call is made.

## Voice-Loop State Management

### `hotkey.ts` Exports

```typescript
isVoiceLoopActive(): boolean  // true while hands-free re-listen is on
stopVoiceLoop(): void           // sets voiceLoop = false (caller handles turn end)
```

Both are used by `ipc.ts` for stop-command detection. `stopVoiceLoop()` does
**not** transition state — the caller (`ipc.ts`) calls `endVoiceTurn()` which
transitions to idle and skips `onLoopContinue` since `voiceLoop` is now false.

### Continuous Listen

The existing `voiceLoop` mechanism already implements continuous listen:
- Ctrl+Space sets `voiceLoop = true` and transitions to `listening`
- `endVoiceTurn()` transitions to idle, then calls `onLoopContinue()` if
  `voiceLoop` is true, which re-arms the mic
- ESC or `stopVoiceLoop()` sets `voiceLoop = false`, so the next
  `endVoiceTurn()` returns to idle without re-listening

No additional toggle is needed. The stop-phrase detection is the missing piece
that was needed for the user to end the loop by voice.

## SSE Events

No new event types. All pipelines now emit `audio_chunk` for TTS audio:

| Event          | Source                        | Description                     |
| -------------- | ----------------------------- | ------------------------------- |
| `llm_chunk`    | Fast path                     | Text delta                      |
| `agent_text`   | Agent path                    | Text delta                      |
| `audio_chunk`  | Both paths (sentence TTS)    | Base64-encoded MP3 audio        |
| `tts_error`    | Both paths (on first failure) | Voice synthesis failed warning  |
| `done`         | Both paths                    | Stream complete                 |

## Files

- `apps/sidecar/src/pipeline/sentence-tts.ts` — shared `EventQueue` and
  `SentenceTts` class
- `apps/sidecar/src/pipeline/fast.ts` — refactored to use shared module
- `apps/sidecar/src/pipeline/agent.ts` — added TTS synthesis via queue
- `apps/desktop/src/main/ipc.ts` — stop-command detection
- `apps/desktop/src/main/hotkey.ts` — `stopVoiceLoop()` export
- `packages/shared/src/index.ts` — `AgentQueryRequest.tts` field