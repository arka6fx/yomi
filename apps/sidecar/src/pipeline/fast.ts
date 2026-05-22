import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { FastQueryRequest, GuideElement, SseEvent } from "@yomi/shared";
import { generateGuide } from "./visual-guide.js";
import { transcribe } from "../speech/transcribe.js";
import { synthesize, resolveTts } from "./tts.js";

const MODEL = process.env.FAST_PATH_MODEL || "claude-haiku-4-5-20251001";

function createModel() {
  if (process.env.LLM_BASE_URL) {
    return createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    })(MODEL);
  }
  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(MODEL);
}

const ANSWER_SYSTEM_PROMPT = `You are a helpful desktop AI assistant.
You see the user's screen and hear their voice.
Answer their question concisely in 1-3 sentences.
If they ask you to show them how to do something, say "I'll guide you through this" and wait for guide mode.`;

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
): AsyncGenerator<SseEvent> {
  const content: any[] = [{ type: "text" as const, text }];

  if (screenshotB64) {
    content.push({
      type: "image" as const,
      image: `data:image/png;base64,${screenshotB64}`,
    });
  }

  const result = streamText({
    model: createModel(),
    messages: [
      {
        role: "system" as const,
        content: ANSWER_SYSTEM_PROMPT,
        ...(process.env.LLM_BASE_URL
          ? {}
          : { experimental_providerMetadata: { anthropic: { cacheControl: { type: "ephemeral" } } } }),
      },
      { role: "user" as const, content },
    ],
    maxTokens: 800,
  });

  const ttsEnabled = resolveTts() !== "none";
  const queue = new EventQueue();
  const ttsTasks: Promise<void>[] = [];

  async function speakSentence(sentence: string): Promise<void> {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    try {
      for await (const audio of synthesize(trimmed)) {
        queue.push({
          type: "audio_chunk",
          base64: Buffer.from(audio).toString("base64"),
        });
      }
    } catch (err) {
      // Audio failure should never kill the text response.
      console.warn("[yomi/tts] synthesis failed:", err);
    }
  }

  const producer = (async () => {
    let buffer = "";
    for await (const chunk of result.textStream) {
      if (!chunk) continue;
      queue.push({ type: "llm_chunk", text: chunk });
      if (!ttsEnabled) continue;
      buffer += chunk;
      let cutAt = findSentenceEnd(buffer);
      while (cutAt !== -1) {
        const sentence = buffer.slice(0, cutAt);
        buffer = buffer.slice(cutAt + 1);
        ttsTasks.push(speakSentence(sentence));
        cutAt = findSentenceEnd(buffer);
      }
    }
    if (ttsEnabled && buffer.trim().length > 0) {
      ttsTasks.push(speakSentence(buffer));
    }
    await Promise.all(ttsTasks);
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
      yield* answerPipeline(text, req.screenshot_b64);
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown pipeline error";
    yield { type: "error", message };
  }
}
