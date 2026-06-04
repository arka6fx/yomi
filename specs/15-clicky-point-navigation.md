# Spec 15 - Clicky-Style Point Navigation

## Purpose

Define Yomi's screen-aware point navigation feature for Windows Electron. The
feature is inspired by Clicky's cursor companion pattern, but implemented inside
Yomi's desktop, sidecar, and shared-contract architecture.

Point navigation helps the user operate visible UI by combining:

- screenshot capture from Electron main,
- sidecar vision prompting,
- structured point/guide events,
- a transparent click-through overlay,
- short text instructions that do not cover the target.

This feature is guidance only. It does not click, type, or automate the user's
apps.

## User Behavior

Users enable the toolbar **Point on** toggle, then ask through Voice or Type.

Examples:

```text
where is the search bar?
```

```text
show me how to save my project step by step
```

```text
where should I click to continue?
```

For simple visible targets, Yomi answers normally and emits one target. For
navigation or "how do I" prompts, Yomi still uses the Clicky-style answer path,
but asks for only the next actionable step and requires a terminal `[POINT...]`
tag when a visible target exists.

Guide behavior is intentionally one step per screenshot:

1. Yomi captures the current screen.
2. Sidecar returns the next actionable visible step only.
3. Sidecar appends `[POINT:x,y:label:screenN]` for a visible target, or
   `[POINT:none]` for a keyboard/text-only step.
4. Desktop strips the tag, points to the visible target, or leaves the text
   instruction in the response.
5. User performs the step.
6. Yomi automatically returns to Listening after a guided step.
7. User says `next` and presses Send/Enter, or types `next`.
8. Yomi recaptures and finds the next real target.

This avoids hallucinating controls that are only visible after the user clicks a
menu or changes app state.

## Shared Contracts

`packages/shared/src/index.ts` owns the public event and request shapes.

```ts
interface ScreenImage {
  screen: number
  screenshot_b64: string
  width: number
  height: number
  is_cursor_screen?: boolean
}

interface PointTarget {
  x: number
  y: number
  label: string
  screen?: number
  coordinateSpace: "screenshot_pixels" | "normalized"
}
```

`FastQueryRequest` includes:

```ts
{
  screenshot_b64?: string
  screenshots?: ScreenImage[]
  mode?: "answer" | "guide"
  pointing?: boolean
}
```

`SseEvent` includes:

```ts
| { type: "point_target"; target: PointTarget | null; reason?: string }
| { type: "visual_guide"; step: number; total_steps: number; instruction: string; elements: GuideElement[] }
```

## Sidecar Behavior

### Answer Mode Pointing

When `pointing: true` or the prompt clearly needs screen context,
`apps/sidecar/src/pipeline/fast.ts` includes screenshots in the LLM request and
appends spatial-pointing instructions.

The model must append exactly one terminal tag:

```text
[POINT:x,y:label]
[POINT:x,y:label:screenN]
[POINT:none]
```

If the target is on the cursor/focus screen, the model may omit `:screenN`. If
the target is on a different monitor, it must include `:screenN`. Desktop maps
omitted screen numbers to the captured display marked `is_cursor_screen`.

The sidecar parses and strips this tag before it reaches:

- visible `llm_chunk` text,
- TTS,
- local memory/session writes.

The parsed target is emitted as `point_target`.

### Clicky-Style Step Navigation

The active step-navigation path uses `apps/sidecar/src/pipeline/fast.ts` answer
mode with `pointing: true`.

Desktop rewrites navigation prompts to ask for one next actionable step visible
on the current screenshot. The normal answer stream is used, and the model
appends the same terminal `[POINT...]` tag as simple pointing.

This is intentionally closer to Clicky's implementation than the JSON guide
planner because:

- streamed answer text remains visible,
- point tags use one consistent parser,
- the same coordinate mapper handles normal and guided targets,
- the model is not asked to hallucinate future UI states.

### Structured Guide Mode

`apps/sidecar/src/pipeline/visual-guide.ts` remains available for explicit
`mode: "guide"` requests and returns exactly one next actionable step for the
current screenshot.

Guide prompt rules:

- Prefer the shortest reliable action.
- For save flows, prefer `Ctrl+S` when it is the correct app convention.
- If a visible Save button/icon exists, point to that.
- Do not point to a File menu unless it is actually required.
- Only return coordinates for controls visible in the current screenshot.
- If the best action is a shortcut or non-visible control, return
  `elements: []`.
- Coordinates must be normalized `0..1` relative to the screenshot.

The sidecar emits a `visual_guide` event for the single next step.

## Desktop Behavior

### Capture

`apps/desktop/src/main/capture.ts` captures all screen sources with
`desktopCapturer` and returns:

- primary `screenshot_b64` for compatibility,
- per-display screenshots,
- `is_cursor_screen` metadata for the display nearest the current pointer,
- display bounds,
- display scale factor,
- screenshot image dimensions.

The desktop sends both the compatibility screenshot and `screenshots[]` to the
sidecar.

### Routing

`apps/desktop/src/main/ipc.ts` decides the sidecar mode:

- Use `mode: "answer"` for normal questions.
- Keep `mode: "answer"` for Point-on navigation prompts, but rewrite the prompt
  to request one next actionable step and send `pointing: true`.
- Navigation prompts include:
  - `step by step`
  - `guide me`
  - `show me how`
  - `where should I click`
  - `save my project`
  - `click first`
- Use the active guide task when the user says/types `next`, `continue`, `done`,
  or `i did it`.

When guide mode starts, desktop immediately shows:

```text
Finding the next step on this screen...
```

This gives visible feedback while the sidecar runs the vision request. The
eventual pointer comes from the `point_target` event parsed from the model's
terminal `[POINT...]` tag.

### Coordinate Mapping

`apps/desktop/src/main/spatial-mapping.ts` maps model coordinates into Windows
logical screen coordinates.

Rules:

- `point_target` can use screenshot pixels or normalized coordinates.
- `visual_guide` boxes are expected to be normalized, but the mapper also
  tolerates pixel boxes.
- Missing `screen` defaults to the cursor/focus display; unknown explicit screen
  numbers fall back to the first captured display.
- Final coordinates are rounded to integer pixels for overlay placement.
- Multi-monitor layouts with negative display bounds are supported.

### Overlay

`apps/desktop/src/main/guide-overlay.ts` owns a transparent, always-on-top,
click-through `BrowserWindow` spanning the full virtual desktop.

Overlay behavior:

- Animated cursor buddy flies to the target.
- Target ring pulses at the mapped coordinate.
- Label shows a compact action cue such as `CLICK THIS` plus the
  step/instruction.
- Label placement stays near the target, flipping and clamping at screen edges
  so it does not cover the thing the user needs to press.
- Top-edge targets, such as menu tabs, keep the same above/left cursor offset
  and clamp to the screen edge; the cursor is not moved below the target.
- Text-only steps, such as `Press Ctrl+S`, render low and centered without a
  target ring.
- Point/guide overlays remain visible briefly after the stream finishes.
- Guided steps automatically return the app to Listening so the user can say
  `next`.
- Guide auto-listening retries until the hotkey state is actually `listening`.
- Guide auto-listening is hands-free: after speech starts, Yomi auto-submits
  after a short silence, and also has a max speech window so continuous noise
  cannot keep it recording forever.
- If no speech is heard, listening times out.
- Turning off Point/Guide cancels scheduled guide timers and hides the overlay.

## Renderer Behavior

`apps/desktop/src/renderer/app.tsx` exposes a **Point on/off** toolbar toggle.

When enabled:

- the button has an active state and lit dot,
- desktop sends `pointing: true`,
- navigation prompts automatically become next-step guide flows.

`apps/desktop/src/renderer/store.ts` stores guide events as readable response
text. The user sees the instruction list in Yomi while the overlay points at the
current target.

## Limitations

- Yomi does not automate clicks or keyboard input.
- A single screenshot cannot reveal controls that appear after a click. The user
  must perform each step and say/type `next` to recapture.
- If the app UI changes during model latency, the pointer may be stale.
  Recapturing with `next` resolves this.
- Vision coordinates depend on model quality and screenshot scaling. The mapper
  handles normalized and pixel boxes, but bad model boxes can still be wrong.

## Tests

Desktop mapping tests live in:

```text
apps/desktop/src/main/spatial-mapping.test.ts
```

Coverage:

- screenshot pixel point targets,
- normalized guide boxes,
- pixel guide boxes,
- multi-monitor negative bounds,
- missing display fallback.

Sidecar point/guide behavior is covered in:

```text
apps/sidecar/src/pipeline/fast.test.ts
```

Coverage:

- `[POINT...]` tags are stripped from visible text,
- `[POINT:none]` emits a null target,
- TTS never speaks point tags,
- `pointing: true` forces screen context for generic directions prompts,
- guide mode emits `visual_guide` events.

## Verification

The CI-relevant commands must pass:

```bash
bun run lint
bun run build:ci
bun run typecheck
bun run test
```

Warnings are currently allowed by the repo ESLint configuration.

## Implemented Files

- `packages/shared/src/index.ts`
- `apps/sidecar/src/pipeline/fast.ts`
- `apps/sidecar/src/pipeline/visual-guide.ts`
- `apps/sidecar/src/pipeline/fast.test.ts`
- `apps/desktop/src/main/capture.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/guide-overlay.ts`
- `apps/desktop/src/main/spatial-mapping.ts`
- `apps/desktop/src/main/spatial-mapping.test.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/app.tsx`
- `apps/desktop/src/renderer/store.ts`
- `apps/desktop/src/renderer/global.d.ts`

## Future Work

- Add an explicit `Next` button in the guide UI as an alternative to
  typing/saying `next`.
- Add a lightweight confidence/retry affordance when the model returns no
  visible target.
- Add optional OCR/DOM/accessibility metadata when available to reduce
  coordinate drift.
- Add an end-to-end desktop smoke test with a synthetic screenshot fixture.
