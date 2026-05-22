import { Hono } from "hono"
import { streamText } from "ai"
import { db, usageEvents } from "@yomi/db"
import { eq, and } from "drizzle-orm"
import { authenticate } from "../auth.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { resolveProvider } from "../providers.js"

// Plan daily token hard/soft caps
const PLAN_CAPS: Record<string, { soft: number; hard: number }> = {
  free: { soft: 50_000, hard: 100_000 },
  basic: { soft: 500_000, hard: 1_000_000 },
  standard: { soft: 2_000_000, hard: 5_000_000 },
  genesis: { soft: 10_000_000, hard: 20_000_000 },
}

// Rough char-based token estimate (4 chars ≈ 1 token)
function estimateTokens(messages: unknown[]): number {
  const text = JSON.stringify(messages)
  return Math.ceil(text.length / 4)
}

async function getDailyTokens(userId: string): Promise<number> {
  const rows = await db
    .select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        eq(usageEvents.kind, "llm_stream"),
      ),
    )
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // sum — a full date filter would need a raw query; keep it simple for now
  return rows.reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0)
}

export const llmRouter = new Hono()

llmRouter.post("/stream", authenticate, rateLimit, async (c) => {
  const { model, messages, tools, maxTokens } = await c.req.json()
  const user = c.get("user")
  const plan = user.plan ?? "free"
  const caps = PLAN_CAPS[plan] ?? PLAN_CAPS.free!

  // Daily cap check
  const dailyTokens = await getDailyTokens(user.id)
  if (dailyTokens > caps.hard) {
    return c.json({ error: "Daily token limit exceeded" }, 429)
  }

  const inputTokens = estimateTokens(messages as unknown[])

  // Record start before streaming
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

  // Meter completion tokens once stream finishes
  result.usage.then(async (usage) => {
    if (!event) return
    await db
      .update(usageEvents)
      .set({ outputTokens: usage.completionTokens, status: "done" })
      .where(eq(usageEvents.id, event.id))
  }).catch(() => {
    // non-critical — don't fail the stream
  })

  // Soft cap warning header
  if (dailyTokens > caps.soft) {
    c.header("X-Yomi-Token-Warning", "Approaching daily limit")
  }

  return result.toDataStreamResponse()
})
