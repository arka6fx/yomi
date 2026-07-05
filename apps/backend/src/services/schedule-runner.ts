import { and, asc, eq, isNotNull, lte } from "drizzle-orm"
import { db, schedules, platformConnections } from "@yomi/db"
import { runAgent } from "../agent/run.js"
import { computeNextRun, type ScheduleType } from "./schedule-parser.js"

const MAX_PER_SWEEP = 25

async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"]
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    })
    return res.ok
  } catch {
    return false
  }
}

async function telegramChatFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      chatId: platformConnections.platformChatId,
      userId: platformConnections.platformUserId,
    })
    .from(platformConnections)
    .where(
      and(eq(platformConnections.userId, userId), eq(platformConnections.platform, "telegram")),
    )
    .limit(1)
  return row?.chatId ?? row?.userId ?? null
}

// Scans for due schedules and runs each: execute the agent, deliver the result, then
// reschedule (or disable one-shots). Called from the Worker cron trigger every minute.
// Each schedule is isolated so one failure doesn't block the rest.
export async function runDueSchedules(now = new Date()): Promise<{ ran: number }> {
  const due = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.enabled, true),
        isNotNull(schedules.nextRunAt),
        lte(schedules.nextRunAt, now),
      ),
    )
    .orderBy(asc(schedules.nextRunAt))
    .limit(MAX_PER_SWEEP)

  let ran = 0
  for (const job of due) {
    let status: "success" | "error" = "success"
    let error: string | null = null
    try {
      const result = await runAgent({
        userId: job.userId,
        text: job.prompt,
        sourcePlatform: "telegram",
      })
      const deliverTo = Array.isArray(job.deliverTo) ? (job.deliverTo as string[]) : ["telegram"]
      if (deliverTo.includes("telegram")) {
        const chatId = await telegramChatFor(job.userId)
        if (!chatId) {
          status = "error"
          error = "No Telegram account linked for delivery."
        } else {
          const sent = await sendTelegram(chatId, `⏰ ${job.prompt}\n\n${result.text}`)
          if (!sent) {
            status = "error"
            error = "Telegram delivery failed."
          }
        }
      }
    } catch (err) {
      status = "error"
      error = err instanceof Error ? err.message.slice(0, 500) : "Schedule run failed"
    }

    const ranAt = new Date()
    const next = job.oneShot
      ? null
      : computeNextRun({
          scheduleType: job.scheduleType as ScheduleType,
          schedule: job.schedule,
          lastRunAt: ranAt,
          now: ranAt,
        })

    await db
      .update(schedules)
      .set({
        lastRunAt: ranAt,
        lastRunStatus: status,
        lastRunError: error,
        runCount: job.runCount + 1,
        nextRunAt: next,
        enabled: job.oneShot ? false : job.enabled,
        updatedAt: ranAt,
      })
      .where(eq(schedules.id, job.id))
      .catch(() => {})
    ran++
  }
  return { ran }
}
