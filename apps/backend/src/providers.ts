import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModelV1 } from "ai"

const anthropic = createAnthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

// OpenRouter via @ai-sdk/openai with custom base URL
const openrouter = createOpenAI({
  baseURL: process.env["LLM_BASE_URL"] ?? "https://openrouter.ai/api/v1",
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
})

// "provider/model" → OpenRouter, otherwise → Anthropic direct
export function resolveProvider(model: string): LanguageModelV1 {
  if (model.includes("/")) return openrouter(model)
  return anthropic(model)
}
