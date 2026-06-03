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

const GUIDE_SYSTEM_PROMPT = `You are in guide mode. The user wants visual navigation.
Return only the NEXT actionable step for the current screenshot, not a full future plan.
Return a JSON object with a \`steps\` array containing exactly one step.
The step has:
- "instruction": a short one-sentence instruction the user can follow
- "elements": UI elements from the screenshot to highlight, with bounding box coordinates
  Each element has: "label" (string) and "bbox" ({ x, y, width, height })

- Prefer the shortest reliable action. For saving files or projects, prefer "Press Ctrl+S" if that is the correct app convention.
- If a visible Save button/icon exists, point to that visible Save target.
- Do not point to a File menu unless opening that menu is actually required and no direct Save control/shortcut is better.
- Only include bounding boxes for elements visible in the screenshot. Do not invent coordinates for controls that appear only after a future click.
- If a step is a keyboard shortcut or a control is not currently visible, return elements as an empty array for that step.
- Coordinates MUST be normalized 0..1 relative to the screenshot: x/y are top-left, width/height are element size.
If you cannot identify specific UI elements, return elements as an empty array and give the safest text instruction.
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
          { type: "image" as const, image: `data:image/jpeg;base64,${screenshotB64}` },
        ],
      },
    ],
    maxTokens: 700,
  })

  let full = ""
  for await (const chunk of result.textStream) {
    full += chunk
  }

  return parseGuideResponse(full)
}
