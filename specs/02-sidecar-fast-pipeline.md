# Spec 02 — Sidecar: Fast Pipeline

## Purpose

Define the fast linear pipeline (STT → LLM → TTS → SSE), visual guidance mode, and prompt caching strategy. This is the hot path — every quick ask flows through here with a < 2s budget.

## Invariants

- The fast path never enters a tool-selection loop. It makes exactly one LLM call.
- The speculative screenshot is grabbed at hotkey press, not after VAD fires (~200ms savings).
- TTS streaming begins on the first sentence boundary — the user hears audio before the LLM finishes.

## Detailed Design

### Fast Pipeline

```
ElevenLabs STT (streaming)
  ↓  partial transcripts feed the LLM before VAD fires
Speculative screenshot (grabbed at hotkey press, parallel to STT)
  ↓
Vercel AI SDK streamText
  model: FAST_PATH_MODEL (default: claude-haiku-4-5-20251001)
  system: cached system prompt + yomi.md
  messages: [{ role: "user", content: [text, image_url] }]
  maxTokens: 800
  ↓
ElevenLabs TTS streaming
  ↓
SSE audio_chunk stream to desktop
```

**Prompt caching:** The system prompt + `yomi.md` content are placed before the first user message to hit Anthropic's cache. Every fast-path call pays only for the new tokens.

### Visual Guidance Mode

When the user asks for step-by-step guidance ("show me how to...", "guide me through..."), the fast path runs in `guide` mode. It produces a visual overlay on the user's screen with arrows and labels pointing to UI elements.

**Flow:**
```
1. User: "guide me through sending a message in Discord"
2. Screenshot captured (current state of the app)
3. LLM call with structured output schema:
   {
     steps: [
       {
         instruction: string,
         elements: {
           label: string,
           bbox: { x, y, width, height }
         }[]
       }
     ]
   }
4. Sidecar emits SSE visual_guide chunks, one per step
5. Desktop renders a transparent overlay with arrows/labels at each bbox
6. User presses Next/Prev to step through
```

**LLM prompt guide mode:** append to the system prompt:
```
You are in guide mode. The user wants you to show them how to do something step by step.
For each step, return:
- instruction: a short instruction the user can follow
- elements: UI elements from the screenshot to highlight, with bounding box coordinates

Keep instructions to 1 sentence. Highlight only the relevant UI element per step.
```

**Fallback:** if the LLM cannot identify UI elements, fall back to text-only instructions. Emit `visual_guide` with `elements: []`. The desktop shows just the text step.

**Speculative screenshot:** grabbed the instant push-to-talk starts, not after VAD fires. This means vision context is ready when the transcript lands. ~200ms savings.

## Files to change

- `apps/sidecar/src/index.ts` — Hono server entry point, route registration
- `packages/shared/src/index.ts` — IPC type definitions

## Files to create

- `apps/sidecar/src/pipeline/fast.ts` — Fast pipeline (STT → LLM → TTS → SSE)
- `apps/sidecar/src/pipeline/visual-guide.ts` — Visual guidance mode

## Open Questions

- Sentence-boundary detection for TTS: `. ` and `\n` are good defaults, but mid-sentence pauses (commas, clauses) may improve perceived naturalness.
