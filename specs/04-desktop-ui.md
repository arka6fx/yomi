# Spec 04 - Desktop UI

## Purpose

Define the Electron renderer UI: floating overlay, streaming response view, account controls, and Cloud RAG source-management UI. The renderer is React and talks only through the preload bridge.

## Invariants

- The UI never calls the sidecar or backend directly.
- All privileged operations go through `window.yomi`.
- The overlay always shows current state: idle, listening, processing, speaking, or error.
- Cloud RAG is opt-in and source-based; no hidden memory sync.
- `html, body { background: transparent; margin: 0 }` is required for transparent windows.

## Renderer Structure

```text
apps/desktop/src/renderer/
  app.tsx
  store.ts
  global.d.ts
```

The current renderer is intentionally compact. It combines overlay, text input, response stream, account status, settings, and Cloud RAG controls in one app surface.

## Main States

| State | UI behavior |
|---|---|
| `idle` | Compact overlay, ready for hotkey or typed prompt |
| `listening` | Recording indicator and cancel action |
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

## Cloud RAG UI

Cloud RAG controls live in the settings/menu surface, not in a separate admin page.

Required controls:

- toggle: enable/disable Cloud RAG retrieval for future questions
- add files: opens the native file picker
- refresh: reloads indexed source list
- source list: filename, status, document count, chunk count, updated time
- delete source: removes a source from the backend index
- inline error/status messages for indexing failures

Expected states:

| State | UI copy/behavior |
|---|---|
| Signed out | Show sign-in prompt; disable source actions |
| Explore plan | Explain that Cloud RAG requires Pro/Max; disable source actions |
| Pro/Max signed in | Enable toggle and source management |
| Indexing | Disable add/delete for the active upload and show progress state |
| Empty | Show a compact empty source list state |

Privacy copy should be direct: local memory is not uploaded; only files the user explicitly chooses are indexed.

## Preload API

```ts
interface YomiApi {
  sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
  submitText(text: string): Promise<void>
  onEvent(cb: (event: SseEvent) => void): () => void
  onStateChange(cb: (state: HotkeyState) => void): () => void
  getCloudRagEnabled(): Promise<boolean>
  setCloudRagEnabled(enabled: boolean): Promise<boolean>
  pickRagFiles(): Promise<RagPickedFile[]>
  indexRagFiles(files: RagPickedFile[]): Promise<RagIndexResult[]>
  listRagSources(): Promise<RagSource[]>
  deleteRagSource(sourceId: string): Promise<void>
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
- Add per-source reindex action.
- Add upload progress for very large text files.
