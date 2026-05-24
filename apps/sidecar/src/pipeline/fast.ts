import { streamText } from "ai";
import type { FastQueryRequest, GuideElement, SseEvent } from "@yomi/shared";
import { generateGuide } from "./visual-guide.js";
import { transcribe } from "../speech/transcribe.js";
import { synthesize, resolveTts } from "./tts.js";
import { createModel } from "./model.js";
import { buildFastPrompt, loadYomiMd, loadMemoryContext } from "../harness/prompt.js";

const MODEL = process.env.FAST_PATH_MODEL || "gpt-4.1-mini";

// yomi.md is stable per-session; memory files change after compaction so load fresh each turn.
let cachedYomiMd: string | null = null
async function getFastPrompt(hasScreen: boolean): Promise<string> {
  if (cachedYomiMd === null) cachedYomiMd = await loadYomiMd()
  const { memorySummary, memoryIndex } = await loadMemoryContext()
  return buildFastPrompt({ yomiMd: cachedYomiMd, memorySummary, memoryIndex, hasScreen })
}

// Tiny single-consumer queue so multiple async producers (LLM text + N concurrent
// TTS streams) can interleave events into one async generator.
class EventQueue {
  private events: SseEvent[] = [];
  private waiter: (() => void) | null = null;
  private closed = false;

  push(ev: SseEvent): void {
    this.events.push(ev);
    this.waiter?.();
    this.waiter = null;
  }

  close(): void {
    this.closed = true;
    this.waiter?.();
    this.waiter = null;
  }

  async *drain(): AsyncGenerator<SseEvent> {
    while (true) {
      if (this.events.length > 0) {
        yield this.events.shift()!;
      } else if (this.closed) {
        return;
      } else {
        await new Promise<void>((r) => { this.waiter = r; });
      }
    }
  }
}

// Decides whether the query actually needs the screenshot in context.
// Errs toward inclusion — missing visual context hurts more than a few extra tokens.
function needsScreenContext(text: string): boolean {
  const q = text.toLowerCase().trim()

  // Unambiguous UI/visual vocabulary
  if (/\b(screen|window|tab|page|app|application|browser|display|monitor|icon|button|popup|dialog|notification|menu|toolbar|sidebar|panel|image|photo|picture|video)\b/.test(q))
    return true

  // Demonstratives or spatial words implying the user is pointing at something visible
  if (/\b(this|that|these|those|here)\b/.test(q))
    return true

  // Phrases that explicitly describe looking at something
  if (/\b(i (can )?see|can you see|what'?s (on|shown|visible|showing)|i'?m (looking|staring) at|what am i (looking|seeing)|what'?s going on (here|there))\b/.test(q))
    return true

  // Personal scheduling / task management — clearly off-screen
  if (/\b(remind me|set (a )?timer|add to (my )?(calendar|list|todo|reminders)|schedule (a )?(meeting|call|event|appointment)|send (an? )?(email|message|text)|book (a )?(meeting|call|flight|hotel))\b/.test(q))
    return false

  // Social acknowledgements
  if (/^(thanks|thank you|ok(ay)?|yes|no|sure|yep|nope|sounds good|perfect|great|got it|cool|awesome|nice|bye|goodbye|hello|hi|hey)\b/.test(q))
    return false

  // Self-contained knowledge question with a named subject (≥3-char word after verb)
  if (/^(what (is|are|was|were|does|do|did) \S{3,}|who (is|was|are|were|invented|created|made|wrote|founded|discovered) \S{3,}|when (was|did|is|are) \S{3,}|where (is|was|are) \S{3,}|why (is|was|does|do|did) \S{3,}|how (does|do|did|can|would|should|to) \S{3,}|explain \S{3,}|define \S{3,}|describe \S{3,})/.test(q))
    return false

  // Creative / generative with a clear non-visual output type
  if (/^(write|draft|compose|create|generate|make|build)\b.{3,}\b(poem|song|email|message|essay|story|article|code|function|script|program|test|class|component|list|outline|summary|plan)\b/.test(q))
    return false

  // Math
  if (/\b(calculate|compute|what'?s \d|how (many|much) (is )?\d|convert \d+|\d+ (plus|minus|times|divided|percent))\b/.test(q))
    return false

  // Default: no screen context — positive signals must justify including the screenshot.
  // False negatives (missed visual query) are better than false positives (LLM
  // anchoring on an irrelevant image and giving a wrong answer).
  return false
}

// Sentence boundary: punctuation followed by whitespace. Returns the
// length-of-prefix that includes the punctuation, or -1 if no boundary.
function findSentenceEnd(buf: string): number {
  const m = buf.match(/[.!?]\s/);
  if (!m || m.index === undefined) return -1;
  return m.index + 1;
}

async function* answerPipeline(
  text: string,
  screenshotB64?: string,
  tts = true,
): AsyncGenerator<SseEvent> {
  const content: any[] = [{ type: "text" as const, text }];

  const hasScreen = !!(screenshotB64 && needsScreenContext(text));
  if (hasScreen) {
    content.push({
      type: "image" as const,
      image: `data:image/png;base64,${screenshotB64}`,
    });
  }

  const systemPrompt = await getFastPrompt(hasScreen);

  const result = streamText({
    model: createModel(MODEL),
    messages: [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content },
    ],
    maxTokens: 800,
  });

  const ttsEnabled = tts && resolveTts() !== "none";
  const queue = new EventQueue();

  // Fetch all audio chunks for one sentence — starts immediately so synthesis
  // runs in parallel with the LLM stream and subsequent sentences.
  async function fetchAudio(sentence: string): Promise<Uint8Array[]> {
    const chunks: Uint8Array[] = [];
    try {
      for await (const audio of synthesize(sentence.trim())) chunks.push(audio);
    } catch (err) {
      console.warn("[yomi/tts] synthesis failed:", err instanceof Error ? err.message : err);
    }
    return chunks;
  }

  const producer = (async () => {
    let buffer = "";
    let gotChunk = false;
    // audioChain enforces ordering: synthesis runs concurrently but each
    // sentence's chunks are pushed only after the previous sentence's chunks
    // are fully in the queue, so playback always follows text order.
    let audioChain = Promise.resolve();

    function enqueueSentence(sentence: string) {
      const audioPromise = fetchAudio(sentence); // start immediately
      audioChain = audioChain.then(async () => {
        for (const chunk of await audioPromise) {
          queue.push({ type: "audio_chunk", base64: Buffer.from(chunk).toString("base64") });
        }
      });
    }

    for await (const chunk of result.textStream) {
      if (!chunk) continue;
      gotChunk = true;
      queue.push({ type: "llm_chunk", text: chunk });
      if (!ttsEnabled) continue;
      buffer += chunk;
      let cutAt = findSentenceEnd(buffer);
      while (cutAt !== -1) {
        enqueueSentence(buffer.slice(0, cutAt));
        buffer = buffer.slice(cutAt + 1);
        cutAt = findSentenceEnd(buffer);
      }
    }
    if (!gotChunk) {
      throw new Error("LLM returned empty response (likely rate-limited or quota exceeded)")
    }
    if (ttsEnabled && buffer.trim().length > 0) enqueueSentence(buffer);
    await audioChain;
  })();

  producer.then(() => queue.close(), (err) => {
    queue.push({ type: "error", message: err instanceof Error ? err.message : String(err) });
    queue.close();
  });

  yield* queue.drain();
  yield { type: "done" };
}

async function* guidePipeline(
  text: string,
  screenshotB64: string,
): AsyncGenerator<SseEvent> {
  if (!screenshotB64) {
    yield {
      type: "visual_guide",
      step: 1,
      total_steps: 1,
      instruction: "Take a screenshot so I can see what you need help with.",
      elements: [],
    };
    yield { type: "done" };
    return;
  }

  const guide = await generateGuide(screenshotB64, text);

  for (const [i, step] of guide.steps.entries()) {
    yield {
      type: "visual_guide",
      step: i + 1,
      total_steps: guide.steps.length,
      instruction: step.instruction,
      elements: step.elements as GuideElement[],
    };
  }

  yield { type: "done" };
}

// Resolves user text from the text field or by transcribing audio_b64.
// Exported so /query can normalise input before classifying intent, then pass
// the resolved text back into fastPipeline (skipping a second STT call).
export async function resolveText(
  req: Pick<FastQueryRequest, "text" | "audio_b64">,
): Promise<string | null> {
  if (req.text?.trim()) return req.text.trim();
  if (req.audio_b64) {
    const wavBytes = Uint8Array.from(Buffer.from(req.audio_b64, "base64"));
    return await transcribe(wavBytes);
  }
  return null;
}

export async function* fastPipeline(
  req: FastQueryRequest,
): AsyncGenerator<SseEvent> {
  let text: string | null;
  try {
    text = await resolveText(req);
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : "STT failed" };
    return;
  }

  if (!text) {
    yield { type: "error", message: "No input text provided" };
    return;
  }

  yield { type: "transcript", text };

  try {
    if (req.mode === "guide") {
      yield* guidePipeline(text, req.screenshot_b64 ?? "");
    } else {
      yield* answerPipeline(text, req.screenshot_b64, req.tts !== false);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown pipeline error";
    yield { type: "error", message };
  }
}
