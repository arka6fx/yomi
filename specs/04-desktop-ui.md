# Spec 04 - Desktop UI

## Purpose

Define the Electron renderer UI: floating overlay, streaming response view, and account controls. The renderer is React and talks only through the preload bridge.

## Invariants

- The UI never calls the sidecar or backend directly.
- All privileged operations go through `window.yomi`.
- The overlay always shows current state: idle, listening, processing, speaking, or error.
- Local memory and the cloud archive mirror are sidecar-owned; the renderer does not expose file upload/index controls.
- `html, body { background: transparent; margin: 0 }` is required for transparent windows.

## Renderer Structure

```text
apps/desktop/src/renderer/
  app.tsx
  store.ts
  global.d.ts
```

The current renderer is intentionally compact. It combines overlay, text input, response stream, account status, and settings in one app surface.

## Main States

| State | UI behavior |
|---|---|
| `idle` | Compact overlay; Voice and Type buttons in toolbar ready to trigger |
| `listening` | Recording indicator; **Send (Enter)** chip to submit, **Stop (Esc)** chip to cancel — both clickable |
| `processing` | Streaming response card with spinner |
| `speaking` | Response remains visible while TTS/audio chunks play |
| `error` | Error message with recovery action |

## Query UI

Users can ask through voice or text. Text mode sends the typed prompt; an empty submit becomes a screen question and includes the current screenshot.

The renderer receives SSE events from main:

```ts
type SseEvent =
  | { type: "transcript"; text: string }
  | { type: "llm_chunk"; text: string }
  | { type: "audio_chunk"; audio_b64: string }
  | { type: "visual_guide"; ... }
  | { type: "done" }
  | { type: "error"; message: string }
```

## Preload API

```ts
interface YomiApi {
  sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
  submitText(text: string): Promise<void>
  onEvent(cb: (event: SseEvent) => void): () => void
  onStateChange(cb: (state: HotkeyState) => void): () => void
  signIn(): Promise<void>
  signOut(): Promise<void>
  getSubscriptionStatus(): Promise<SubscriptionStatus>
}
```

## Visual Guide Overlay

Visual guide mode renders structured steps from the sidecar:

```ts
interface GuideStep {
  instruction: string
  elements: {
    label: string
    bbox: { x: number; y: number; width: number; height: number }
  }[]
}
```

The guide overlay remains transparent and click-through except for navigation controls.

## Implemented Files

- `apps/desktop/src/renderer/app.tsx`
- `apps/desktop/src/renderer/store.ts`
- `apps/desktop/src/renderer/global.d.ts`
- `apps/desktop/src/preload/index.ts`

## Future Work

- Split the current compact UI into reusable components once the surface grows.
- Add a user-visible local memory browser/editor.
