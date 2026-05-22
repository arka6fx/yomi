import { streamText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import type { GuideResponse } from "@yomi/shared"

const MODEL = process.env.FAST_PATH_MODEL || "gpt-4.1-mini"

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

function createModel() {
  return openai(MODEL)
}

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
  const result = streamText({
    model: createModel(),
    messages: [
      { role: "system" as const, content: GUIDE_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: userQuery },
          { type: "image" as const, image: `data:image/png;base64,${screenshotB64}` },
        ],
      },
    ],
    maxTokens: 2000,
  })

  let full = ""
  for await (const chunk of result.textStream) {
    full += chunk
  }

  return parseGuideResponse(full)
}
