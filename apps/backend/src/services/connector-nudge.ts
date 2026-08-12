import { eq, isNotNull } from "drizzle-orm"
import { db } from "@yomi/db"
import { STARTER_PROMPTS } from "@yomi/shared/starter-prompts"
import * as authSchema from "../auth-schema.js"
import { getConnectorDef } from "../connectors/registry.js"
import { sendTelegram, telegramChatFor } from "./telegram-delivery.js"

const NUDGE_DEBOUNCE_MS = 5 * 60 * 1000
const MAX_NUDGE_PROMPTS = 3

export interface PendingNudge {
  connectorIds: string[]
  dueAt: string
}

// Fixed-window debounce: the first connect in a burst sets dueAt 5 minutes out;
// later connects in the same window extend the connector list but never push
// dueAt further, so a nudge is always guaranteed to fire.
export function computeNextNudgeState(
  existing: PendingNudge | null,
  connectorId: string,
  now: Date,
): PendingNudge {
  if (!existing) {
    return {
      connectorIds: [connectorId],
      dueAt: new Date(now.getTime() + NUDGE_DEBOUNCE_MS).toISOString(),
    }
  }
  const connectorIds = existing.connectorIds.includes(connectorId)
    ? existing.connectorIds
    : [...existing.connectorIds, connectorId]
  return { connectorIds, dueAt: existing.dueAt }
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0] ?? ""
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`
}

// Builds the Telegram nudge text from a batch of newly-connected connector ids.
// Single connector: up to 2 of its prompts. Multiple: 1 prompt each, capped at
// MAX_NUDGE_PROMPTS total (earliest-connected connectors win ties).
export function buildNudgeMessage(connectorIds: string[]): string | null {
  if (connectorIds.length === 0) return null

  const prompts: string[] = []
  if (connectorIds.length === 1) {
    const [id] = connectorIds
    prompts.push(...(STARTER_PROMPTS[id ?? ""] ?? []).slice(0, 2))
  } else {
    for (const id of connectorIds) {
      const [first] = STARTER_PROMPTS[id] ?? []
      if (first) prompts.push(first)
      if (prompts.length >= MAX_NUDGE_PROMPTS) break
    }
  }
  if (prompts.length === 0) return null

  const names = connectorIds
    .filter((id) => (STARTER_PROMPTS[id] ?? []).length > 0)
    .map((id) => getConnectorDef(id)?.name ?? id)
  const suffix = names.length === 1 ? " is" : " are"
  const header = `🔌 ${joinNames(names)}${suffix} connected. Try:`
  const body = prompts.length === 1 ? `"${prompts[0]}"` : prompts.map((p) => `• ${p}`).join("\n")
  return `${header}\n${body}`
}

function parsePendingNudge(value: unknown): PendingNudge | null {
  if (!value || typeof value !== "object") return null
  const v = value as Partial<PendingNudge>
  if (!Array.isArray(v.connectorIds) || typeof v.dueAt !== "string") return null
  return { connectorIds: v.connectorIds, dueAt: v.dueAt }
}

// Called after a genuinely new connector connection (never a reconnect) —
// see Tasks 7-8 for the "was this new" check at each call site.
// Known race (accepted, not fixed here): this is a SELECT-then-UPDATE, not
// atomic. Two near-simultaneous connects for the same user can each read the
// same pre-update row and one write can clobber the other, dropping a
// connector id from the debounce batch. Blast radius is a missed prompt in
// the nudge, not data corruption — a real fix needs a conditional/atomic
// jsonb update, out of scope for this pass.
export async function markConnectorConnected(userId: string, connectorId: string): Promise<void> {
  const [row] = await db
    .select({ pendingConnectorNudge: authSchema.user.pendingConnectorNudge })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)
  const existing = parsePendingNudge(row?.pendingConnectorNudge)
  const next = computeNextNudgeState(existing, connectorId, new Date())
  await db
    .update(authSchema.user)
    .set({ pendingConnectorNudge: next })
    .where(eq(authSchema.user.id, userId))
}

// Scans for due connector nudges and sends each via Telegram — a template
// fill, not an agent run. Called from the same 60s cron tick as
// runDueSchedules (worker.ts, index.ts). Each user is isolated so one
// failure doesn't block the rest.
// Known race (accepted, not fixed here): the "not due yet" check below reads
// pendingConnectorNudge, and a later markConnectorConnected() call from a
// fresh connect can land between that read and this loop's clearing UPDATE —
// the fresh connector id gets silently erased instead of debounced. Blast
// radius is a missed onboarding nudge, not data corruption.
export async function runDueConnectorNudges(now: Date = new Date()): Promise<{ ran: number }> {
  const rows = await db
    .select({
      id: authSchema.user.id,
      pendingConnectorNudge: authSchema.user.pendingConnectorNudge,
    })
    .from(authSchema.user)
    .where(isNotNull(authSchema.user.pendingConnectorNudge))

  let ran = 0
  for (const row of rows) {
    const nudge = parsePendingNudge(row.pendingConnectorNudge)
    if (!nudge) {
      // Malformed nudge JSON can never become due — clear it so it doesn't
      // get re-fetched by every future sweep tick forever.
      await db
        .update(authSchema.user)
        .set({ pendingConnectorNudge: null })
        .where(eq(authSchema.user.id, row.id))
        .catch((err) =>
          console.error(`[connector-nudge] clear malformed nudge failed for user ${row.id}:`, err),
        )
      continue
    }
    if (new Date(nudge.dueAt) > now) continue

    try {
      const chatId = await telegramChatFor(row.id)
      if (chatId) {
        const text = buildNudgeMessage(nudge.connectorIds)
        if (text) await sendTelegram(chatId, text)
      }
    } catch (err) {
      console.error(`[connector-nudge] user ${row.id} failed:`, err)
    } finally {
      await db
        .update(authSchema.user)
        .set({ pendingConnectorNudge: null })
        .where(eq(authSchema.user.id, row.id))
        .catch((err) => console.error(`[connector-nudge] clear failed for user ${row.id}:`, err))
      ran++
    }
  }
  return { ran }
}
