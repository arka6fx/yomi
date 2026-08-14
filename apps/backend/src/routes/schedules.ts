import { Hono } from "hono"
import { and, desc, eq } from "drizzle-orm"
import { db, schedules } from "@yomi/db"
import { authenticate } from "../auth.js"
import { effectivePlanForUser } from "../entitlements.js"
import {
  computeNextRun,
  scheduleLimitForPlan,
  validateScheduleInput,
} from "../services/schedule-parser.js"
import { ensureScheduleCapacity } from "../services/schedule-quota.js"

export const schedulesRouter = new Hono()

schedulesRouter.use("*", authenticate)

type ScheduleBody = {
  schedule?: string
  prompt?: string
  deliverTo?: string[]
  enabled?: boolean
}

schedulesRouter.get("/", async (c) => {
  const user = c.get("user")
  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.userId, user.id))
    .orderBy(desc(schedules.createdAt))
    .limit(100)
  return c.json({
    schedules: rows,
    limit: scheduleLimitForPlan(effectivePlanForUser(user)),
  })
})

schedulesRouter.post("/", async (c) => {
  const user = c.get("user")
  const body = (await c.req.json().catch(() => ({}))) as ScheduleBody

  const capacity = await ensureScheduleCapacity(user)
  if (!capacity.ok) return c.json(capacity.body, capacity.status)

  const schedule = body.schedule?.trim()
  const prompt = body.prompt?.trim()
  if (!schedule) return c.json({ error: "schedule is required", code: "invalid_schedule" }, 400)
  if (!prompt) return c.json({ error: "prompt is required", code: "invalid_prompt" }, 400)

  const valid = validateScheduleInput(schedule)
  if (!valid.ok || !valid.scheduleType)
    return c.json({ error: valid.error ?? "invalid schedule", code: "invalid_schedule" }, 400)

  const nextRunAt = computeNextRun({ scheduleType: valid.scheduleType, schedule })
  const deliverTo =
    Array.isArray(body.deliverTo) && body.deliverTo.length ? body.deliverTo : ["telegram"]

  const [row] = await db
    .insert(schedules)
    .values({
      userId: user.id,
      schedule,
      scheduleType: valid.scheduleType,
      prompt,
      deliverTo,
      enabled: body.enabled ?? true,
      oneShot: valid.scheduleType === "iso",
      nextRunAt,
    })
    .returning()
  return c.json({ schedule: row })
})

schedulesRouter.patch("/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  const body = (await c.req.json().catch(() => ({}))) as ScheduleBody

  const [existing] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.userId, user.id), eq(schedules.id, id)))
    .limit(1)
  if (!existing) return c.json({ error: "schedule not found", code: "not_found" }, 404)

  const update: Partial<typeof schedules.$inferInsert> = { updatedAt: new Date() }
  let scheduleType = existing.scheduleType as ReturnType<
    typeof validateScheduleInput
  >["scheduleType"]
  let scheduleStr = existing.schedule

  if (
    typeof body.schedule === "string" &&
    body.schedule.trim() &&
    body.schedule.trim() !== existing.schedule
  ) {
    const valid = validateScheduleInput(body.schedule.trim())
    if (!valid.ok || !valid.scheduleType)
      return c.json({ error: valid.error ?? "invalid schedule", code: "invalid_schedule" }, 400)
    scheduleStr = body.schedule.trim()
    scheduleType = valid.scheduleType
    update.schedule = scheduleStr
    update.scheduleType = valid.scheduleType
    update.oneShot = valid.scheduleType === "iso"
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) update.prompt = body.prompt.trim()
  if (Array.isArray(body.deliverTo)) update.deliverTo = body.deliverTo
  if (typeof body.enabled === "boolean") update.enabled = body.enabled

  // Recompute next run when the schedule changed or the job was (re)enabled.
  const enabledNow = update.enabled ?? existing.enabled
  if (update.schedule || (update.enabled === true && !existing.enabled)) {
    update.nextRunAt =
      enabledNow && scheduleType
        ? computeNextRun({ scheduleType, schedule: scheduleStr, lastRunAt: existing.lastRunAt })
        : null
  } else if (update.enabled === false) {
    update.nextRunAt = null
  }

  const [row] = await db
    .update(schedules)
    .set(update)
    .where(and(eq(schedules.userId, user.id), eq(schedules.id, id)))
    .returning()
  return c.json({ schedule: row })
})

schedulesRouter.delete("/:id", async (c) => {
  const user = c.get("user")
  const id = c.req.param("id")
  const deleted = await db
    .delete(schedules)
    .where(and(eq(schedules.userId, user.id), eq(schedules.id, id)))
    .returning({ id: schedules.id })
  return c.json({ ok: true, deleted: deleted.length })
})
