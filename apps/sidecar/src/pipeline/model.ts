import { createOpenAI } from "@ai-sdk/openai"

const backendUrl = process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL
const sessionToken = process.env.YOMI_SESSION_TOKEN

const openai = createOpenAI({
  apiKey: sessionToken || process.env.OPENAI_API_KEY,
  baseURL:
    backendUrl && sessionToken
      ? `${backendUrl.replace(/\/+$/, "")}/api/v1`
      : process.env.OPENAI_BASE_URL,
})

export function createModel(modelId: string) {
  return openai(modelId)
}
