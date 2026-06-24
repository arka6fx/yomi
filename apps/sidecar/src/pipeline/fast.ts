import { streamText } from "ai"
import type { FastQueryRequest, Plan, ScreenImage, SseEvent } from "@yomi/shared"
import { transcribe } from "../speech/transcribe.js"
import { synthesize, resolveTts } from "./tts.js"
import { createModel } from "./model.js"
import { buildFastPrompt, loadSoulMd, loadYomiMd } from "../harness/prompt.js"
import { getConnectorRegistry } from "../connectors/registry.js"
import { maybeHandleSoulOnboarding } from "./soul-onboarding.js"
import {
  captureStructuredMemory,
  loadMemoryContext,
  writeSessionTurn,
  type MemoryContextBundle,
} from "../memory/subsystem.js"
import { reserveInteraction } from "../usage/reserve.js"

const MODEL = process.env.AI_CREDITS_FAST_MODEL || "gpt-5.5-mini"

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
let cachedSoulMd: string | null = null
function memoryEnabled(plan: Plan | undefined): boolean {
  return plan === "pro" || plan === "max"
}
// All plan tiers (explore/pro/max) get voice; undefined means unauthenticated
// or desktop dev mode — fall through to env-based TTS resolution.
function voiceEnabled(plan: Plan | undefined, ttsReq: boolean): boolean {
  if (!ttsReq) return false
  if (plan === "explore" || plan === "pro" || plan === "max") return resolveTts() !== "none"
  // No plan: respect env-based TTS config (allows local dev with API key)
  return resolveTts() !== "none"
}

async function getFastPrompt(
  text: string,
  hasScreen: boolean,
  plan: Plan | undefined,
  preloaded?: Promise<MemoryContextBundle>,
): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  if (cachedSoulMd === null) cachedSoulMd = await loadSoulMd()
  const memory = memoryEnabled(plan)
  const localCtx = memory
    ? await (preloaded ?? loadMemoryContext(text))
    : {
      memorySummary: "",
      memoryIndex: "",
      durableMemory: "",
      localMemory: "",
      cloudRagContext: "",
      staticProfile: "",
      dynamicProfile: "",
      recentSession: "",
    }
  const connectedProviders = getConnectorRegistry().getConnected()
  return buildFastPrompt({ yomiMd: cachedYomiMd, soulMd: cachedSoulMd, ...localCtx, hasScreen, connectedProviders })
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

// The first spoken segment gets a looser boundary so audio starts sooner: cut at the
// first clause boundary (comma/semicolon/colon) past a minimum length, or fall back to a
// word boundary near the max. Only used for the opening segment — later segments use
// full-sentence boundaries to keep prosody natural. Returns the slice length or -1.
const FIRST_SEG_MIN = 6
const FIRST_SEG_MAX = 32
function findFirstSegmentCut(buf: string): number {
  const clause = buf.slice(0, FIRST_SEG_MAX).match(/[,;:]\s/)
  if (clause && clause.index !== undefined && clause.index >= FIRST_SEG_MIN) {
    return clause.index + 1
  }
  if (buf.length >= FIRST_SEG_MAX) {
    const lastSpace = buf.lastIndexOf(" ", FIRST_SEG_MAX)
    if (lastSpace >= FIRST_SEG_MIN) return lastSpace
  }
  return -1
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
  signal?: AbortSignal,
  history?: { role: "user" | "assistant"; text: string }[],
  preloadedMemory?: Promise<MemoryContextBundle>,
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
  const hasScreen = images.length > 0 && needsScreenContext(text)
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

  const systemPrompt = await getFastPrompt(text, hasScreen, plan, preloadedMemory)

  const result = streamText({
    model: createModel(MODEL),
    messages: [
      { role: "system" as const, content: systemPrompt },
      ...(history ?? []).map((h) => ({ role: h.role as "user" | "assistant", content: h.text })),
      { role: "user" as const, content },
    ],
    maxTokens: maxOutputTokensFor(text),
    abortSignal: signal, // barge-in / client disconnect cancels the LLM request
  })

  const ttsEnabled = voiceEnabled(plan, tts)
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
    let gotChunk = false
    let speechFenceOpen = false
    let firstSegment = true // opening segment flushes early for faster time-to-first-audio
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
        const chunks = await audioPromise
        if (chunks.length === 0) return
        const totalLen = chunks.reduce((acc, c) => acc + c.length, 0)
        const merged = new Uint8Array(totalLen)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        queue.push({ type: "audio_chunk", base64: Buffer.from(merged).toString("base64") })
      })
    }

    function flushVisibleText(textChunk: string) {
      if (!textChunk) return
      queue.push({ type: "llm_chunk", text: textChunk })
      if (!ttsEnabled) return
      buffer += visibleSpeechText(textChunk)
      let cutAt = findSentenceEnd(buffer)
      if (cutAt === -1 && firstSegment) cutAt = findFirstSegmentCut(buffer)
      while (cutAt !== -1) {
        enqueueSentence(buffer.slice(0, cutAt))
        buffer = buffer.slice(cutAt + 1)
        firstSegment = false
        cutAt = findSentenceEnd(buffer)
      }
    }

    try {
      for await (const chunk of result.fullStream) {
        if (signal?.aborted) break
        if (chunk.type === "text-delta") {
          if (!chunk.textDelta) continue
          gotChunk = true
          flushVisibleText(chunk.textDelta)
        } else if (chunk.type === "error") {
          const errMsg = chunk.error instanceof Error ? chunk.error.message : String(chunk.error)
          throw new Error(`LLM stream error: ${errMsg}`)
        }
      }
    } catch (err) {
      if (signal?.aborted) return
      throw err
    }
    if (signal?.aborted) return
    if (!gotChunk) {
      throw new Error("Yomi had trouble getting a response. Try again in a moment.")
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

export async function* fastPipeline(
  req: FastQueryRequest,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  // For text queries (typed / Telegram / gateway) the query is known immediately —
  // kick off memory loading in parallel with the quota check so it overlaps network
  // I/O rather than running sequentially after STT.
  const earlyMemory: Promise<MemoryContextBundle> | undefined =
    memoryEnabled(req.plan) && req.text?.trim()
      ? loadMemoryContext(req.text.trim())
      : undefined

  if (!req.skipReserve) {
    const reservation = await reserveInteraction("chat")
    if (!reservation.ok) {
      yield {
        type: "usage_limit",
        code: reservation.code,
        feature: reservation.feature ?? "chat",
        message: reservation.error,
        upgradeUrl: reservation.upgradeUrl,
      }
      return
    }
  }

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

  const soulOnboarding = maybeHandleSoulOnboarding(text)
  if (soulOnboarding) {
    yield { type: "llm_chunk", text: soulOnboarding }
    yield { type: "done" }
    return
  }

  try {
    let output = ""
    for await (const event of answerPipeline(
      text,
      req.screenshot_b64,
      req.tts !== false,
      req.plan,
      req.screenshots ?? [],
      signal,
      req.history,
      earlyMemory,
    )) {
      if (signal?.aborted) break
      if (event.type === "llm_chunk") output += event.text
      yield event
    }
    // Skip the memory write for a barged-in (partial) turn.
    if (!signal?.aborted && memoryEnabled(req.plan) && output.trim()) {
      writeSessionTurn({ kind: "fast", mode: "answer", input: text, output })
      captureStructuredMemory({ input: text, output, mode: "answer" }).catch((err: unknown) =>
        console.warn("[yomi/fast] memory capture failed:", err),
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown pipeline error"
    yield { type: "error", message }
  }
}
