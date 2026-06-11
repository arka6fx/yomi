// ── AWS Bedrock — MiniMax M2.5 via OpenAI-compatible mantle endpoint ─────────
import { createOpenAI } from "@ai-sdk/openai"

const bedrock = createOpenAI({
  apiKey: process.env.AWS_BEDROCK_BEARER_TOKEN,
  baseURL:
    process.env.AWS_BEDROCK_BASE_URL || "https://bedrock-mantle.us-east-1.api.aws/v1",
})

export function createModel(modelId: string) {
  return bedrock(modelId)
}

// ── Legacy: OpenAI / AI Credits (kept for rollback) ─────────────────────────
// import { createOpenAI } from "@ai-sdk/openai"
//
// const backendUrl = process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL
// const sessionToken = process.env.YOMI_SESSION_TOKEN
//
// const openai = createOpenAI({
//   apiKey: sessionToken || process.env.OPENAI_API_KEY,
//   baseURL:
//     backendUrl && sessionToken
//       ? `${backendUrl.replace(/\/+$/, "")}/api/v1`
//       : process.env.OPENAI_BASE_URL,
// })
//
// export function createModel(modelId: string) {
//   return openai(modelId)
// }
