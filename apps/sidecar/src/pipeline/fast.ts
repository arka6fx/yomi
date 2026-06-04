import { streamText } from "ai"
import type {
  FastQueryRequest,
  GuideElement,
  Plan,
  PointTarget,
  ScreenImage,
  SseEvent,
} from "@yomi/shared"
import { generateGuide } from "./visual-guide.js"
import { transcribe } from "../speech/transcribe.js"
import { synthesize, resolveTts } from "./tts.js"
import { createModel } from "./model.js"
import { buildFastPrompt, loadYomiMd } from "../harness/prompt.js"
import {
  captureStructuredMemory,
  loadMemoryContext,
  writeSessionTurn,
} from "../memory/subsystem.js"

const MODEL = process.env.FAST_PATH_MODEL || "gpt-4.1-mini"

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}

async function getFastPrompt(
  text: string,
  hasScreen: boolean,
  plan: Plan | undefined,
): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  const memory = memoryEnabled(plan)
  const localCtx = memory
    ? await loadMemoryContext(text)
    : {
        memorySummary: "",
        memoryIndex: "",
        localMemory: "",
        cloudRagContext: "",
        staticProfile: "",
        dynamicProfile: "",
        recentSession: "",
      }
  return buildFastPrompt({ yomiMd: cachedYomiMd, ...localCtx, hasScreen })
}

// Tiny single-consumer queue so multiple async producers (LLM text + N concurrent
// TTS streams) can interleave events into one async generator.
class EventQueue {
  private events: SseEvent[] = []
  private waiter: (() => void) | null = null
  private closed = false

  push(ev: SseEvent): void {
    this.events.push(ev)
    this.waiter?.()
    this.waiter = null
  }

  close(): void {
    this.closed = true
    this.waiter?.()
    this.waiter = null
  }

  async *drain(): AsyncGenerator<SseEvent> {
    while (true) {
      if (this.events.length > 0) {
        yield this.events.shift()!
      } else if (this.closed) {
        return
      } else {
        await new Promise<void>((r) => {
          this.waiter = r
        })
      }
    }
  }
}

// Decides whether the query actually needs the screenshot in context.
// Errs toward inclusion — missing visual context hurts more than a few extra tokens.
function needsScreenContext(text: string): boolean {
  const q = text.toLowerCase().trim()

  // Unambiguous UI/visual vocabulary
  if (
    /\b(screen|window|tab|page|app|application|browser|display|monitor|icon|button|link|field|input|search|button|popup|dialog|notification|menu|toolbar|sidebar|panel|image|photo|picture|video)\b/.test(
      q,
    )
  )
    return true

  // Demonstratives or spatial words implying the user is pointing at something visible
  if (/\b(this|that|these|those|here)\b/.test(q)) return true

  // Phrases that explicitly describe looking at something
  if (
    /\b(i (can )?see|can you see|what'?s (on|shown|visible|showing)|i'?m (looking|staring) at|what am i (looking|seeing)|what'?s going on (here|there))\b/.test(
      q,
    )
  )
    return true

  // Personal scheduling / task management — clearly off-screen
  if (
    /\b(remind me|set (a )?timer|add to (my )?(calendar|list|todo|reminders)|schedule (a )?(meeting|call|event|appointment)|send (an? )?(email|message|text)|book (a )?(meeting|call|flight|hotel))\b/.test(
      q,
    )
  )
    return false

  // Social acknowledgements
  if (
    /^(thanks|thank you|ok(ay)?|yes|no|sure|yep|nope|sounds good|perfect|great|got it|cool|awesome|nice|bye|goodbye|hello|hi|hey)\b/.test(
      q,
    )
  )
    return false

  // Self-contained knowledge question with a named subject (≥3-char word after verb)
  if (
    /^(what (is|are|was|were|does|do|did) \S{3,}|who (is|was|are|were|invented|created|made|wrote|founded|discovered) \S{3,}|when (was|did|is|are) \S{3,}|where (is|was|are) \S{3,}|why (is|was|does|do|did) \S{3,}|how (does|do|did|can|would|should|to) \S{3,}|explain \S{3,}|define \S{3,}|describe \S{3,})/.test(
      q,
    )
  )
    return false

  // Creative / generative with a clear non-visual output type
  if (
    /^(write|draft|compose|create|generate|make|build)\b.{3,}\b(poem|song|email|message|essay|story|article|code|function|script|program|test|class|component|list|outline|summary|plan)\b/.test(
      q,
    )
  )
    return false

  // Math
  if (
    /\b(calculate|compute|what'?s \d|how (many|much) (is )?\d|convert \d+|\d+ (plus|minus|times|divided|percent))\b/.test(
      q,
    )
  )
    return false

  // Default: no screen context — positive signals must justify including the screenshot.
  // False negatives (missed visual query) are better than false positives (LLM
  // anchoring on an irrelevant image and giving a wrong answer).
  return false
}

// Sentence boundary: punctuation followed by whitespace. Returns the
// length-of-prefix that includes the punctuation, or -1 if no boundary.
function findSentenceEnd(buf: string): number {
  const m = buf.match(/[.!?]\s/)
  if (!m || m.index === undefined) return -1
  return m.index + 1
}

function sanitizeSentenceForSpeech(sentence: string): string {
  return sentence
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\bTime:\s*O\(([^)]+)\)/gi, "Time complexity O($1)")
    .replace(/\bSpace:\s*O\(([^)]+)\)/gi, "Space complexity O($1)")
    .replace(/\s+/g, " ")
    .trim()
}

const POINT_TAIL_LIMIT = 96
const POINT_TAG_RE =
  /\[POINT:(?:none|(\d+)\s*,\s*(\d+)(?::([^\]:\s][^\]:]*?))?(?::screen(\d+))?)\]\s*$/i

function parsePointTag(text: string): { text: string; target: PointTarget | null; found: boolean } {
  const match = text.match(POINT_TAG_RE)
  if (!match) return { text, target: null, found: false }

  const cleanText = text.slice(0, match.index).trimEnd()
  const [, xRaw, yRaw, labelRaw, screenRaw] = match
  if (!xRaw || !yRaw) return { text: cleanText, target: null, found: true }

  return {
    text: cleanText,
    found: true,
    target: {
      x: Number(xRaw),
      y: Number(yRaw),
      label: (labelRaw ?? "target").trim().slice(0, 48) || "target",
      screen: screenRaw ? Number(screenRaw) : undefined,
      coordinateSpace: "screenshot_pixels",
    },
  }
}

function maxOutputTokensFor(text: string): number {
  const q = text.toLowerCase()
  if (
    /\b(application|letter|biography|bio|essay|article|story|speech|report|write|draft|compose)\b/.test(
      q,
    )
  ) {
    return 1400
  }
  if (/\b(code|program|function|algorithm|leetcode|solution|complexity|debug)\b/.test(q)) {
    return 1200
  }
  if (/\b(explain in detail|walkthrough|step by step|detailed|briefly but complete)\b/.test(q)) {
    return 1100
  }
  return 800
}

async function* answerPipeline(
  text: string,
  screenshotB64?: string,
  tts = true,
  plan?: Plan,
  screenshots: ScreenImage[] = [],
  pointing = false,
): AsyncGenerator<SseEvent> {
  const content: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text },
  ]

  const images =
    screenshots.length > 0
      ? screenshots
      : screenshotB64
        ? [{ screen: 1, screenshot_b64: screenshotB64, width: 0, height: 0 }]
        : []
  const hasScreen = images.length > 0 && (pointing || needsScreenContext(text))
  if (hasScreen) {
    const labels = images
      .map(
        (img) =>
          `screen${img.screen}${img.is_cursor_screen ? " (cursor/focus screen)" : ""}: ${img.width || "unknown"}x${img.height || "unknown"} pixels`,
      )
      .join("\n")
    content[0] = {
      type: "text",
      text: `${text}\n\nScreenshots are labeled:\n${labels}`,
    }
    for (const img of images) {
      content.push({
        type: "image",
        image: `data:image/jpeg;base64,${img.screenshot_b64}`,
      })
    }
  }

  let systemPrompt = await getFastPrompt(text, hasScreen, plan)
  if (hasScreen) {
    systemPrompt += `

Spatial pointing:
- The user has spatial pointing ${pointing ? "enabled" : "available"}.
- You have a small blue cursor that can fly to and point at things on screen.
- Use it whenever pointing would genuinely help: navigation, finding a button/menu/field, showing where to click, or explaining a visible UI.
- Err on the side of pointing for on-screen tasks.
- When you point, append exactly one coordinate tag at the very end, after the spoken text.
- The screenshot images are labeled with their pixel dimensions. Use those dimensions as the coordinate space.
- Origin is top-left. x increases rightward, y increases downward.
- Put the coordinate at the visual center of the clickable control itself, not on nearby text, menu labels, shadows, or empty padding.
- If a target is partly visible, point at the center of the visible clickable part.
- Format: [POINT:x,y:label] or [POINT:x,y:label:screenN].
- If the element is on the cursor/focus screen, you can omit the screen number. If it is on another screen, include :screenN.
- If pointing would not help, append [POINT:none].
- Do not mention the tag in the answer.
- If the user asks where to click, how to navigate, or asks for directions on screen, you must point at the most relevant currently visible target.
- For step-by-step guidance, give only the next actionable step for the current screenshot.`
  }

  const result = streamText({
    model: createModel(MODEL),
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content },
    ],
    maxTokens: maxOutputTokensFor(text),
  })

  const ttsEnabled = tts && resolveTts() !== "none"
  const queue = new EventQueue()
  let ttsErrorEmitted = false

  // Fetch all audio chunks for one sentence — starts immediately so synthesis
  // runs in parallel with the LLM stream and subsequent sentences.
  async function fetchAudio(sentence: string): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = []
    try {
      for await (const audio of synthesize(sentence.trim())) chunks.push(audio)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[yomi/tts] synthesis failed:", message)
      if (!ttsErrorEmitted) {
        ttsErrorEmitted = true
        queue.push({
          type: "tts_error",
          message: "Voice synthesis failed. Text response is still available.",
        })
      }
    }
    return chunks
  }

  const producer = (async () => {
    let buffer = ""
    let pointTail = ""
    let gotChunk = false
    let speechFenceOpen = false
    // audioChain enforces ordering: synthesis runs concurrently but each
    // sentence's chunks are pushed only after the previous sentence's chunks
    // are fully in the queue, so playback always follows text order.
    let audioChain = Promise.resolve()

    function visibleSpeechText(chunk: string): string {
      let out = ""
      let rest = chunk
      while (rest.length > 0) {
        const fenceAt = rest.indexOf("```")
        if (fenceAt === -1) {
          if (!speechFenceOpen) out += rest
          break
        }
        if (!speechFenceOpen) out += rest.slice(0, fenceAt)
        rest = rest.slice(fenceAt + 3)
        if (!speechFenceOpen) {
          const firstNewline = rest.indexOf("\n")
          rest = firstNewline === -1 ? "" : rest.slice(firstNewline + 1)
        }
        speechFenceOpen = !speechFenceOpen
      }
      return out
    }

    function enqueueSentence(sentence: string) {
      const speech = sanitizeSentenceForSpeech(sentence)
      if (!speech) return
      const audioPromise = fetchAudio(speech) // start immediately
      audioChain = audioChain.then(async () => {
        for (const chunk of await audioPromise) {
          queue.push({ type: "audio_chunk", base64: Buffer.from(chunk).toString("base64") })
        }
      })
    }

    function flushVisibleText(textChunk: string) {
      if (!textChunk) return
      queue.push({ type: "llm_chunk", text: textChunk })
      if (!ttsEnabled) return
      buffer += visibleSpeechText(textChunk)
      let cutAt = findSentenceEnd(buffer)
      while (cutAt !== -1) {
        enqueueSentence(buffer.slice(0, cutAt))
        buffer = buffer.slice(cutAt + 1)
        cutAt = findSentenceEnd(buffer)
      }
    }

    for await (const chunk of result.textStream) {
      if (!chunk) continue
      gotChunk = true
      if (!hasScreen) {
        flushVisibleText(chunk)
        continue
      }
      pointTail += chunk
      if (pointTail.length > POINT_TAIL_LIMIT) {
        const flushLen = pointTail.length - POINT_TAIL_LIMIT
        flushVisibleText(pointTail.slice(0, flushLen))
        pointTail = pointTail.slice(flushLen)
      }
    }
    if (!gotChunk) {
      throw new Error("LLM returned empty response (likely rate-limited or quota exceeded)")
    }
    if (hasScreen) {
      const parsed = parsePointTag(pointTail)
      flushVisibleText(parsed.text)
      queue.push({ type: "point_target", target: parsed.target })
    }
    if (ttsEnabled && buffer.trim().length > 0) enqueueSentence(buffer)
    await audioChain
  })()

  producer.then(
    () => queue.close(),
    (err) => {
      queue.push({ type: "error", message: err instanceof Error ? err.message : String(err) })
      queue.close()
    },
  )

  yield* queue.drain()
  yield { type: "done" }
}

async function* guidePipeline(text: string, screenshotB64: string): AsyncGenerator<SseEvent> {
  if (!screenshotB64) {
    yield {
      type: "visual_guide",
      step: 1,
      total_steps: 1,
      instruction: "Take a screenshot so I can see what you need help with.",
      elements: [],
    }
    yield { type: "done" }
    return
  }

  const guide = await generateGuide(screenshotB64, text)

  for (const [i, step] of guide.steps.entries()) {
    yield {
      type: "visual_guide",
      step: i + 1,
      total_steps: guide.steps.length,
      instruction: step.instruction,
      elements: step.elements as GuideElement[],
    }
  }

  yield { type: "done" }
}

// Resolves user text from the text field or by transcribing audio_b64.
// Exported so /query can normalise input before classifying intent, then pass
// the resolved text back into fastPipeline (skipping a second STT call).
export async function resolveText(
  req: Pick<FastQueryRequest, "text" | "audio_b64">,
): Promise<string | null> {
  if (req.text?.trim()) return req.text.trim()
  if (req.audio_b64) {
    const wavBytes = Uint8Array.from(Buffer.from(req.audio_b64, "base64"))
    return await transcribe(wavBytes)
  }
  return null
}

export async function* fastPipeline(req: FastQueryRequest): AsyncGenerator<SseEvent> {
  let text: string | null
  try {
    text = await resolveText(req)
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : "STT failed" }
    return
  }

  if (!text) {
    yield { type: "error", message: "No input text provided" }
    return
  }

  yield { type: "transcript", text }

  try {
    let output = ""
    if (req.mode === "guide") {
      for await (const event of guidePipeline(text, req.screenshot_b64 ?? "")) {
        if (event.type === "visual_guide") output += `${event.instruction}\n`
        yield event
      }
    } else {
      for await (const event of answerPipeline(
        text,
        req.screenshot_b64,
        req.tts !== false,
        req.plan,
        req.screenshots ?? [],
        req.pointing === true,
      )) {
        if (event.type === "llm_chunk") output += event.text
        yield event
      }
    }
    if (memoryEnabled(req.plan) && output.trim()) {
      writeSessionTurn({ kind: "fast", mode: req.mode ?? "answer", input: text, output })
        .then(() => captureStructuredMemory({ input: text, output, mode: req.mode ?? "answer" }))
        .catch((err) => console.warn("[yomi/fast] memory write failed:", err))
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown pipeline error"
    yield { type: "error", message }
  }
}
