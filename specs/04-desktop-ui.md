# Spec 04 - Desktop UI

## Purpose

Define the Electron renderer UI: notch/tray status, Mission Control, streaming
response view, and account controls. The renderer is React and talks only
through the preload bridge.

## Invariants

- The UI never calls the sidecar or backend directly.
- All privileged operations go through `window.yomi`.
- The notch/tray status always shows current state: idle, listening, processing,
  speaking, error, or foreground automation progress.
- No floating agent companion or detached background-agent dock is allowed.
- Local memory and the cloud archive mirror are sidecar-owned; the renderer does
  not expose file upload/index controls.
- `html, body { background: transparent; margin: 0 }` is required for
  transparent windows.

## Renderer Structure

```text
apps/desktop/src/renderer/
  app.tsx
  store.ts
  global.d.ts
  theme.tsx
  mission/
    MissionControl.tsx
```

The current renderer is intentionally compact. It combines notch/tray status,
text input, response stream, Mission Control, account status, settings, theme
extraction, and automation confirmation in one app surface.

## Main States

| State        | UI behavior                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `idle`       | Compact notch/tray status; Voice and Type controls ready to trigger                                  |
| `listening`  | Recording indicator; **Send (Enter)** chip to submit, **Stop (Esc)** chip to cancel — both clickable |
| `processing` | Streaming response card with spinner                                                                 |
| `speaking`   | Response remains visible while TTS/audio chunks play                                                 |
| `error`      | Error message with recovery action                                                                   |

## Surface Model

Yomi should feel like an OS companion, not a floating mascot panel. The persistent
surface is the notch/tray status pill. Mission Control is the detailed view for
foreground automation timelines, approvals, previews, cancellation, and
completed results.

Avoid persistent floating companions for routine chat or automation progress. A
transient guide overlay is allowed only for screen-aware visual guidance or
automation confirmation, and it should be click-through whenever possible.

## Query UI

Users can ask through voice or text. Text mode sends the typed prompt; an empty
submit becomes a screen question and includes the current screenshot.

The renderer receives SSE events from main:

```ts
type SseEvent =
  | { type: "transcript"; text: string }
  | { type: "llm_chunk"; text: string }
  | { type: "audio_chunk"; audio_b64: string }
  | { type: "visual_guide"; ... }
  | { type: "agent_step"; step: number; text: string; tool_calls: ToolCall[] }
  | { type: "subagent_step"; agent: string; step: number; text: string }
  | { type: "act_proposed"; act_id: string; action: string; target: string }
  | { type: "act_result"; act_id: string; success: boolean; error?: string }
  | { type: "automation_plan"; steps: string[] }
  | { type: "automation_progress"; step: number; total: number; status: string }
  | { type: "router_decision"; path: "fast" | "agent" }
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
  setActMode(enabled: boolean): Promise<void>
  confirmAct(actId: string): Promise<void>
  replayAutomation(runId: string): Promise<void>
  onLoopContinue(cb: () => void): () => void
  requestEscape(): Promise<void>
  stopListening(): void
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

The guide overlay remains transparent and click-through except for navigation
controls. It is a temporary guidance layer, not the main Yomi surface.

## Implemented Files

- `apps/desktop/src/renderer/app.tsx`
- `apps/desktop/src/renderer/store.ts`
- `apps/desktop/src/renderer/global.d.ts`
- `apps/desktop/src/renderer/theme.tsx`
- `apps/desktop/src/renderer/mission/MissionControl.tsx`
- `apps/desktop/src/preload/index.ts`

## Future Work

- Split the current compact UI into reusable components once the surface grows.
- Add a user-visible local memory browser/editor.
