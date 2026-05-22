import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModelV1 } from "ai"

const openai = createOpenAI({
  apiKey: process.env["OPENAI_API_KEY"],
  baseURL: process.env["OPENAI_BASE_URL"],
})

export function resolveProvider(model: string): LanguageModelV1 {
  return openai(model)
}
