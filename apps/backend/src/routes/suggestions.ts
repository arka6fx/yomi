import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { db, schedules, suggestionDecisions } from "@yomi/db"
import { authenticate } from "../auth.js"
import { offerableFor, findEntry } from "../services/suggestions/catalog.js"
import { ensureScheduleCapacity } from "../services/schedule-quota.js"
import { computeNextRun, validateScheduleInput } from "../services/schedule-parser.js"

export const suggestionsRouter = new Hono()

suggestionsRouter.use("*", authenticate)

suggestionsRouter.get("/", async (c) => {
  const user = c.get("user")
  const offers = await offerableFor(user.id)
  return c.json({
    suggestions: offers.map((e) => ({
      dedupKey: e.dedupKey,
      title: e.title,
      description: e.description,
      schedulePreview: e.spec.schedule,
    })),
  })
})

suggestionsRouter.post("/:dedupKey/accept", async (c) => {
  const user = c.get("user")
  const key = c.req.param("dedupKey")
  const entry = findEntry(key ?? "")
  const offers = await offerableFor(user.id)
  if (!entry || !offers.some((e) => e.dedupKey === entry.dedupKey)) {
    return c.json({ error: "Suggestion not available", code: "not_offerable" }, 404)
  }

  const capacity = await ensureScheduleCapacity(user)
  if (!capacity.ok) return c.json(capacity.body, capacity.status)

  const valid = validateScheduleInput(entry.spec.schedule)
  if (!valid.ok || !valid.scheduleType)
    return c.json({ error: "catalog schedule invalid", code: "invalid_schedule" }, 500)

  const [schedule] = await db
    .insert(schedules)
    .values({
      userId: user.id,
      schedule: entry.spec.schedule,
      scheduleType: valid.scheduleType,
      prompt: entry.spec.prompt,
      deliverTo: entry.spec.deliverTo,
      enabled: true,
      oneShot: false,
      nextRunAt: computeNextRun({ scheduleType: valid.scheduleType, schedule: entry.spec.schedule }),
    })
    .returning()
  if (!schedule) return c.json({ error: "failed to create schedule", code: "create_failed" }, 500)

  try {
    await db.insert(suggestionDecisions).values({
      userId: user.id,
      dedupKey: entry.dedupKey,
      decision: "accepted",
      scheduleId: schedule.id,
    })
  } catch {
    // Unique violation: a concurrent accept already decided this key — the
    // schedule created by THIS call must not survive as a duplicate.
    await db.delete(schedules).where(eq(schedules.id, schedule.id))
    return c.json({ error: "Already decided", code: "already_decided" }, 409)
  }
  return c.json({ scheduleId: schedule.id })
})

suggestionsRouter.post("/:dedupKey/dismiss", async (c) => {
  const user = c.get("user")
  const key = c.req.param("dedupKey")
  const entry = findEntry(key ?? "")
  if (!entry) return c.json({ error: "Unknown suggestion", code: "not_offerable" }, 404)
  try {
    await db.insert(suggestionDecisions).values({
      userId: user.id,
      dedupKey: entry.dedupKey,
      decision: "dismissed",
      scheduleId: null,
    })
  } catch {
    // already decided — dismiss is idempotent
  }
  return c.json({ ok: true })
})
