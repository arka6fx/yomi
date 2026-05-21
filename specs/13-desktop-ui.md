# Spec 13 — Desktop: UI

## Purpose

Define the renderer process: floating buddy window, status pill, settings panel, and visual guide overlay. All UI components are React running in an Electron renderer process.

## Invariants

- The UI never calls the sidecar directly — all IPC goes through the preload bridge.
- The visual guide overlay is a separate transparent window with mouse passthrough.
- Status indicator always shows current Yomi state (listening / thinking / idle / error).
- `html, body { background: transparent; margin: 0 }` is required — without this the BrowserWindow's `transparent: true` has no effect.

## Detailed Design

### Renderer Structure

```
apps/desktop/src/renderer/
  index.html        Shell HTML
  app.tsx           React root — routing, state management
  components/
    BuddyWindow.tsx      Main floating window
    StatusPill.tsx       Notch / tray status indicator
    Settings.tsx         Settings panel
    GuideOverlay.tsx     Transparent overlay with step arrows
    GuideStep.tsx        Single step highlight with label
```

### Overlay (`app.tsx` — spec 12 + 13)

Before the full BuddyWindow exists, `app.tsx` is the entire UI — a single floating overlay that collapses to a status pill and expands to show the streaming response.

**States:**
- `idle` — small pill, `position: fixed; bottom: 24px; right: 24px`
- `listening` — pill shows animated recording dot
- `processing` — pill shows spinner, expands as `llm_chunk` events arrive
- `done` — full response text, dismiss on click; auto-dismiss after 8s

**Audio capture (renderer-side):**

```ts
// Request mic permission at app start (keep stream alive)
const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
const ctx = new AudioContext({ sampleRate: 16000 })
const source = ctx.createMediaStreamSource(stream)
const processor = ctx.createScriptProcessor(4096, 1, 1)
processor.onaudioprocess = (e) => {
  const pcm = e.inputBuffer.getChannelData(0)
  window.yomi.sendAudioChunk(pcm.buffer.slice(0), 16000)  // copy buffer — reused by AudioContext
}
source.connect(processor)
processor.connect(ctx.destination)
```

Start capturing only when state transitions to `listening`. `ScriptProcessorNode` is deprecated but universally supported without AudioWorklet complexity.

**Type declarations** (`renderer/global.d.ts`):

```ts
import type { SseEvent } from "@yomi/shared"
declare global {
  interface Window {
    yomi: {
      sendAudioChunk(pcm: ArrayBuffer, sampleRate: number): void
      onEvent(cb: (e: SseEvent) => void): () => void
      onState(cb: (s: string) => void): () => void
    }
  }
}
```

### Floating Window (BuddyWindow)

The main interaction surface. A small, draggable, always-on-top window. _(after spec 13 ships)_

- Quick ask input (mic button + optional text field)
- Streaming transcript display
- Agent task progress (status updates, tool calls)
- Settings gear icon → opens Settings panel

### Status Indicator (StatusPill)

A minimal visual indicator shown in the notch (macOS) or tray area. Shows current state:

| State | Appearance |
|---|---|
| Idle | Dim indicator |
| Listening | Pulsing recording dot |
| Thinking | Spinner |
| Speaking | Audio waveform |
| Error | Red indicator |

Rendered as a small always-on-top `BrowserWindow` or embedded in the tray icon depending on platform.

### Settings Panel

Slide-out panel with:
- Account section (sign in/out, plan info)
- Voice settings (TTS provider, voice selection)
- Microphone device selection
- Hotkey configuration
- Permissions status (mic, screen recording)
- About / version

### Visual Guide Overlay

Rendered as a separate transparent click-through `BrowserWindow` positioned at (0,0) spanning the full screen. Mouse events pass through to the underlying app.

```
┌─────────────────────────────────────────────┐
│  ← Step 2 of 4 →  ✕                        │  nav bar
│                                              │
│        ┌──────────────┐                     │
│        │ Messages tab  │ ← ─ ─ ─ ─ ─ ─      │  highlighted element
│        │ ┌───┐        │                     │  with arrow + label
│        │ │ 3 │        │                     │
│        │ └───┘        │                     │
│        └──────────────┘                     │
│                                              │
│  Click the Messages tab at the top left      │  instruction text
└─────────────────────────────────────────────┘
```

```typescript
interface GuideElement {
  label: string
  bbox: { x: number; y: number; width: number; height: number }
}

interface GuideStep {
  instruction: string
  elements: GuideElement[]
}
```

**Implementation:**
- `BrowserWindow` with `transparent: true`, `frame: false`, `alwaysOnTop: true`, mouse passthrough
- React renders SVG arrows + labels at bbox coordinates from the sidecar
- Nav bar (Step X of Y, Prev/Next, Close) is the only interactive region
- On Close or last step, overlay is hidden
- Refresh button to re-screenshot and recalculate if target window moves

## Files to change

- `apps/desktop/src/renderer/app.tsx` — MVP overlay: status pill + streaming response

## Files to create

- `apps/desktop/src/renderer/global.d.ts` — `window.yomi` TypeScript interface
- `apps/desktop/src/renderer/components/BuddyWindow.tsx` — Main floating window _(after spec 13 ships)_
- `apps/desktop/src/renderer/components/StatusPill.tsx` — Notch/tray status indicator _(after spec 13 ships)_
- `apps/desktop/src/renderer/components/Settings.tsx` — Settings panel _(after spec 13 ships)_
- `apps/desktop/src/renderer/components/GuideOverlay.tsx` — Visual guide overlay _(after spec 06 agent loop)_
- `apps/desktop/src/renderer/components/GuideStep.tsx` — Single step highlight _(after spec 06 agent loop)_

## Open Questions

- ~~State management: React context vs Zustand vs Jotai~~ — **decided: Zustand** (`src/renderer/store.ts`). Single `useYomiStore` with `hotkeyState`, `responseText`, `guideSteps`, `transcript`, `error`. `handleSseEvent` drives all state transitions from SSE events.
- Overlay multi-monitor support: position overlay across all screens vs only the active screen.
- `ScriptProcessorNode` deprecation: migrate to `AudioWorkletNode` when spec 04 STT abstraction ships.
