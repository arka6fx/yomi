import { Hono } from "hono"
import { streamText } from "ai"
import { db, usageEvents } from "@yomi/db"
import { eq } from "drizzle-orm"
import { authenticate } from "../auth.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { requireAccess } from "../middleware/subscription.js"
import { resolveProvider } from "../providers.js"
import { effectivePlanForUser } from "../entitlements.js"

// Soft/hard daily token caps by plan (secondary guard — primary is requireAccess chat limit)
const PLAN_CAPS: Record<string, { soft: number; hard: number }> = {
  explore: { soft: 100_000, hard: 200_000 },
  pro: { soft: 2_000_000, hard: 5_000_000 },
  max: { soft: 10_000_000, hard: 20_000_000 },
}

function estimateTokens(messages: unknown[]): number {
  return Math.ceil(JSON.stringify(messages).length / 4)
}

export const llmRouter = new Hono()

llmRouter.post("/stream", authenticate, requireAccess("chat"), rateLimit, async (c) => {
  const { model, messages, tools, maxTokens } = await c.req.json()
  const user = c.get("user")
  const caps = PLAN_CAPS[effectivePlanForUser(user)] ?? PLAN_CAPS.explore!

  // Token hard-cap (rough estimate — actual metering happens post-stream)
  const inputTokens = estimateTokens(messages as unknown[])
  if (inputTokens > caps.hard) {
    return c.json({ error: "Daily token limit exceeded" }, 429)
  }

  const [event] = await db
    .insert(usageEvents)
    .values({
      userId: user.id,
      kind: "llm_stream",
      model: model as string,
      inputTokens,
      outputTokens: 0,
      costCents: 0,
      status: "started",
    })
    .returning({ id: usageEvents.id })

  const provider = resolveProvider(model as string)

  const result = streamText({
    model: provider,
    messages: messages as Parameters<typeof streamText>[0]["messages"],
    tools: tools as Parameters<typeof streamText>[0]["tools"],
    maxTokens: maxTokens as number | undefined,
  })

  result.usage
    .then(async (usage) => {
      if (!event) return
      await db
        .update(usageEvents)
        .set({ outputTokens: usage.completionTokens, status: "done" })
        .where(eq(usageEvents.id, event.id))
    })
    .catch(() => {})

  if (inputTokens > caps.soft) {
    c.header("X-Yomi-Token-Warning", "Approaching daily limit")
  }

  return result.toDataStreamResponse()
})
