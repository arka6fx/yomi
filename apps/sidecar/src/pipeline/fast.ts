import { streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { FastQueryRequest, GuideElement, SseEvent } from "@yomi/shared";
import { generateGuide } from "./visual-guide.js";

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

  for await (const chunk of result.textStream) {
    if (chunk) yield { type: "llm_chunk", text: chunk };
  }

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

export async function* fastPipeline(
  req: FastQueryRequest,
): AsyncGenerator<SseEvent> {
  const text = req.text?.trim();
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
