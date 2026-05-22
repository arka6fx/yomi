import { generateObject, jsonSchema } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { IntentClassification, RouterInput } from "@yomi/shared"

const ROUTER_SYSTEM_PROMPT =
  `You classify user requests for a desktop AI assistant into two pipelines.
fast: questions, explanations, translations, summaries — any direct single-step answer.
agent: action verbs (research, draft, send, schedule, create, open, file, deploy) or multi-part tasks.
Default to fast when unsure. Reply with path, confidence (0..1), and a reason under 15 words.`

const RouterDecision = jsonSchema<{ path: "fast" | "agent"; confidence: number; reason: string }>({
  type: "object",
  properties: {
    path: { type: "string", enum: ["fast", "agent"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string", maxLength: 120 },
  },
  required: ["path", "confidence", "reason"],
})

const TIMEOUT_MS = parseInt(process.env.ROUTER_LLM_TIMEOUT_MS || "250", 10)
const MODEL = process.env.FAST_PATH_MODEL || "claude-haiku-4-5-20251001"

function createModel() {
  if (process.env.LLM_BASE_URL) {
    return createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    })(MODEL)
  }
  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(MODEL)
}

function buildPrompt(input: RouterInput): string {
  const parts = [`User request: "${input.text}"`]
  if (input.history?.length) {
    const recent = input.history.slice(-2).map(t => `${t.role}: ${t.text}`).join("\n")
    parts.push(`Recent context:\n${recent}`)
  }
  return parts.join("\n\n")
}

export async function classifyWithLlm(input: RouterInput): Promise<IntentClassification> {
  const { object } = await generateObject({
    model: createModel(),
    schema: RouterDecision,
    system: ROUTER_SYSTEM_PROMPT,
    prompt: buildPrompt(input),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    maxTokens: 80,
  })
  return { ...object, source: "llm" }
}
