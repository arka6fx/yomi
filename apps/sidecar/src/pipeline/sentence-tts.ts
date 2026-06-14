import type { SseEvent } from "@yomi/shared"
import { synthesize, resolveTts } from "./tts.js"

// Sentence boundary: punctuation followed by whitespace.
function findSentenceEnd(buf: string): number {
  const m = buf.match(/[.!?]\s/)
  if (!m || m.index === undefined) return -1
  return m.index + 1
}

// First segment: looser boundary so audio starts sooner.
const FIRST_SEG_MIN = 4
const FIRST_SEG_MAX = 64
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

// Tiny single-consumer queue for interleaving LLM text + TTS audio events.
export class EventQueue {
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

// Fetch all audio chunks for one sentence. Starts immediately so synthesis
// runs in parallel with the LLM stream and subsequent sentences.
async function fetchAudio(sentence: string): Promise<{ chunks: Uint8Array[]; failed: boolean }> {
  const chunks: Uint8Array[] = []
  let failed = false
  try {
    for await (const audio of synthesize(sentence.trim())) chunks.push(audio)
  } catch {
    failed = true
  }
  return { chunks, failed }
}

// Sentence-level TTS accumulator. Feed text chunks via `feedText()`, and
// it enqueues `audio_chunk` events into the queue in sentence order.
export class SentenceTts {
  private buffer = ""
  private firstSegment = true
  private ttsErrorEmitted = false
  private audioChain = Promise.resolve()
  private ttsEnabled: boolean
  private speechFenceOpen = false

  constructor(
    private queue: EventQueue,
    tts = true,
  ) {
    this.ttsEnabled = tts && resolveTts() !== "none"
  }

  // Call this for each text delta from the LLM. Emits `llm_chunk`/`agent_text`
  // events and queues sentence-level TTS audio.
  feedText(textChunk: string, eventType: "llm_chunk" | "agent_text" = "llm_chunk"): void {
    this.queue.push({ type: eventType, text: textChunk } as SseEvent)
    if (!this.ttsEnabled) return

    // Strip code blocks from speech; visible text still goes to the renderer.
    const visible = this.stripCodeFences(textChunk)
    this.buffer += visible
    let cutAt = findSentenceEnd(this.buffer)
    if (cutAt === -1 && this.firstSegment) cutAt = findFirstSegmentCut(this.buffer)
    while (cutAt !== -1) {
      this.enqueueSentence(this.buffer.slice(0, cutAt))
      this.buffer = this.buffer.slice(cutAt + 1)
      this.firstSegment = false
      cutAt = findSentenceEnd(this.buffer)
    }
  }

  // Flush any remaining buffered text as a final sentence.
  flush(): void {
    if (this.ttsEnabled && this.buffer.trim().length > 0) {
      this.enqueueSentence(this.buffer)
      this.buffer = ""
    }
  }

  // Wait for all pending audio synthesis to complete.
  async drain(): Promise<void> {
    await this.audioChain
  }

  // Strip text inside ``` ``` code fences so TTS doesn't read code aloud.
  private stripCodeFences(chunk: string): string {
    let out = ""
    let rest = chunk
    while (rest.length > 0) {
      const fenceAt = rest.indexOf("```")
      if (fenceAt === -1) {
        if (!this.speechFenceOpen) out += rest
        break
      }
      if (!this.speechFenceOpen) out += rest.slice(0, fenceAt)
      rest = rest.slice(fenceAt + 3)
      if (!this.speechFenceOpen) {
        // Skip the language tag line after the opening fence
        const firstNewline = rest.indexOf("\n")
        rest = firstNewline === -1 ? "" : rest.slice(firstNewline + 1)
      }
      this.speechFenceOpen = !this.speechFenceOpen
    }
    return out
  }

  private enqueueSentence(sentence: string): void {
    const speech = sanitizeSentenceForSpeech(sentence)
    if (!speech) return
    const audioPromise = fetchAudio(speech)
    this.audioChain = this.audioChain.then(async () => {
      const result = await audioPromise
      if (result.failed && !this.ttsErrorEmitted) {
        this.ttsErrorEmitted = true
        this.queue.push({
          type: "tts_error",
          message: "Voice synthesis failed. Text response is still available.",
        })
      }
      if (result.chunks.length === 0) return
      for (const chunk of result.chunks) {
        this.queue.push({ type: "audio_chunk", base64: Buffer.from(chunk).toString("base64") })
      }
    })
  }
}