import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import type { GuideResponse } from "@yomi/shared"

const openai = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
})

const MODEL = process.env.FAST_PATH_MODEL || "openai/gpt-4o"

const GUIDE_SYSTEM_PROMPT = `You are in guide mode. The user wants step-by-step visual guidance.
For each step, return a JSON object with a \`steps\` array.
Each step has:
- "instruction": a short one-sentence instruction the user can follow
- "elements": UI elements from the screenshot to highlight, with bounding box coordinates
  Each element has: "label" (string) and "bbox" ({ x, y, width, height })

Coordinate values are relative to the screenshot dimensions.
If you cannot identify specific UI elements, return elements as an empty array.
Output ONLY valid JSON, no markdown, no explanation.`

function parseGuideResponse(text: string): GuideResponse {
  try {
    const cleaned = text.replace(/```(?:json)?\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)
    return { steps: parsed.steps ?? [] }
  } catch {
    return {
      steps: [{ instruction: "I couldn't identify visual targets from this screenshot.", elements: [] }],
    }
  }
}

export async function generateGuide(
  screenshotB64: string,
  userQuery: string,
): Promise<GuideResponse> {
  const messages: any[] = [
    { role: "system", content: GUIDE_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: userQuery },
        {
          type: "image",
          image: `data:image/png;base64,${screenshotB64}`,
        },
      ],
    },
  ]

  const result = streamText({
    model: openai(MODEL),
    messages,
    maxTokens: 2000,
  })

  let full = ""
  for await (const chunk of result.textStream) {
    full += chunk
  }

  return parseGuideResponse(full)
}
