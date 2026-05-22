import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"

// Shared model factory used by both fast and agent pipelines.
export function createModel(modelId: string) {
  if (process.env.LLM_BASE_URL) {
    return createOpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    })(modelId)
  }
  return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId)
}
