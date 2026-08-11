import { and, desc, eq, lte } from "drizzle-orm"
import { db, pendingActions } from "@yomi/db"

export type PendingActionRisk = "write" | "send" | "paid" | "irreversible"
export type PendingActionStatus =
  | "pending"
  | "approved"
  | "denied"
  | "executed"
  | "failed"
  | "expired"

export interface CreatePendingActionInput {
  userId: string
  connector: string
  action: string
  risk: PendingActionRisk
  title: string
  preview: string
  confirmText?: string
  payload: unknown
  sourcePlatform?: string
  sourceChatId?: string
  requestedByRunId?: string
  expiresInMinutes?: number
}

interface GmailSendPayload {
  to: string[]
  subject: string
  body: string
  cc?: string[]
  bcc?: string[]
  replyToMessageId?: string
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function parseGmailSendPayload(payload: unknown): GmailSendPayload {
  if (!payload || typeof payload !== "object") throw new Error("Invalid Gmail payload")
  const p = payload as Record<string, unknown>
  if (!isStringArray(p["to"]) || p["to"].length === 0) throw new Error("Missing Gmail recipients")
  if (typeof p["subject"] !== "string") throw new Error("Missing Gmail subject")
  if (typeof p["body"] !== "string") throw new Error("Missing Gmail body")
  if (p["cc"] !== undefined && !isStringArray(p["cc"])) throw new Error("Invalid Gmail cc")
  if (p["bcc"] !== undefined && !isStringArray(p["bcc"])) throw new Error("Invalid Gmail bcc")
  if (p["replyToMessageId"] !== undefined && typeof p["replyToMessageId"] !== "string") {
    throw new Error("Invalid Gmail reply id")
  }
  return {
    to: p["to"],
    subject: p["subject"],
    body: p["body"],
    cc: p["cc"],
    bcc: p["bcc"],
    replyToMessageId: p["replyToMessageId"],
  }
}

export async function createPendingAction(input: CreatePendingActionInput) {
  const [existing] = await db
    .select({ id: pendingActions.id, status: pendingActions.status })
    .from(pendingActions)
    .where(
      and(
        eq(pendingActions.userId, input.userId),
        eq(pendingActions.connector, input.connector),
        eq(pendingActions.action, input.action),
        eq(pendingActions.status, "pending"),
      ),
    )
    .limit(1)
  if (existing) {
    return {
      id: existing.id,
      status: existing.status,
      message: pendingApprovalMessage(input.title, input.preview),
    }
  }

  const now = Date.now()
  const expiresAt = new Date(now + (input.expiresInMinutes ?? 30) * 60 * 1000)
  const [row] = await db
    .insert(pendingActions)
    .values({
      userId: input.userId,
      connector: input.connector,
      action: input.action,
      risk: input.risk,
      title: input.title,
      preview: input.preview,
      confirmText: input.confirmText,
      payload: input.payload,
      sourcePlatform: input.sourcePlatform,
      sourceChatId: input.sourceChatId,
      requestedByRunId: input.requestedByRunId,
      expiresAt,
    })
    .returning({ id: pendingActions.id, status: pendingActions.status })

  if (!row) throw new Error("Failed to create pending action")

  // Send the card ourselves rather than trusting the model to relay it. The model was
  // told to summarise "in one short line", so it compressed the recipient, subject and
  // body out of existence — the user was approving an email they could not see. An
  // approval gate that hides what it is approving is not a safety mechanism, so this
  // is awaited: the card IS the gate, not a nicety to fire and forget.
  await sendApprovalCard(input.sourcePlatform, input.sourceChatId, row.id, input.title, input.preview)

  return {
    id: row.id,
    status: row.status,
    message: pendingApprovalMessage(input.title, input.preview),
  }
}

export function formatApprovalCard(title: string, preview?: string): string {
  const details = preview?.trim() ? `\n\n${preview.trim()}` : ""
  return `Approval needed: ${title}${details}\n\nReply "yes" to approve or "no" to cancel.`
}

async function sendApprovalCard(
  sourcePlatform: string | undefined,
  sourceChatId: string | undefined,
  actionId: string,
  title: string,
  preview?: string,
): Promise<void> {
  if (!sourcePlatform || !sourceChatId) return
  try {
    const { getDefaultGateway } = await import("../gateway/index.js")
    await getDefaultGateway().sendMessage(
      sourcePlatform as "telegram",
      sourceChatId,
      formatApprovalCard(title, preview),
      {
        buttons: [
          [
            { text: "✅ Approve", callbackData: `approve:${actionId}` },
            { text: "❌ Deny", callbackData: `deny:${actionId}` },
          ],
        ],
      },
    )
  } catch (err) {
    // The action still exists and the tool result carries the details, but the user
    // did not see the card — worth knowing about.
    console.warn(
      "[pending-actions] failed to send approval card:",
      err instanceof Error ? err.message : String(err),
    )
  }
}

// Tool-result text the agent relays to the user when an action is queued. Feeds
// the model the full details (time, recipients, ...) and the exact approval
// phrasing so the user can approve conversationally, no slash command needed.
function pendingApprovalMessage(title: string, preview?: string): string {
  const details = preview?.trim() ? `\n${preview.trim()}` : ""
  return `This action needs the user's approval before it runs: ${title}${details}\n\nAsk the user to reply "yes" to approve or "no" to cancel.`
}

export async function expirePendingActions(userId?: string) {
  const where = userId
    ? and(
        eq(pendingActions.userId, userId),
        eq(pendingActions.status, "pending"),
        lte(pendingActions.expiresAt, new Date()),
      )
    : and(eq(pendingActions.status, "pending"), lte(pendingActions.expiresAt, new Date()))
  await db.update(pendingActions).set({ status: "expired", updatedAt: new Date() }).where(where)
}

export async function listPendingActions(userId: string, status = "pending") {
  await expirePendingActions(userId)
  return db
    .select({
      id: pendingActions.id,
      connector: pendingActions.connector,
      action: pendingActions.action,
      risk: pendingActions.risk,
      title: pendingActions.title,
      preview: pendingActions.preview,
      confirmText: pendingActions.confirmText,
      status: pendingActions.status,
      result: pendingActions.result,
      expiresAt: pendingActions.expiresAt,
      createdAt: pendingActions.createdAt,
      updatedAt: pendingActions.updatedAt,
    })
    .from(pendingActions)
    .where(and(eq(pendingActions.userId, userId), eq(pendingActions.status, status)))
    .orderBy(desc(pendingActions.createdAt))
    .limit(50)
}

async function executePendingAction(row: {
  userId: string
  connector: string
  action: string
  payload: unknown
}) {
  if (row.connector === "google" && row.action === "gmail.sendEmail") {
    const payload = parseGmailSendPayload(row.payload)
    const [{ GoogleGmailConnector }, { getAccessToken }] = await Promise.all([
      import("@yomi/agent-core/connectors/google-gmail"),
      import("./integration-tokens.js"),
    ])
    const gmail = new GoogleGmailConnector(row.userId, getAccessToken)
    const result = await gmail.sendEmail(payload)
    return {
      ok: true,
      messageId: result.messageId,
      threadId: result.threadId,
      message: `Email sent to ${payload.to.join(", ")}.`,
    }
  }

  // Generic connector-tool replay: `action` is the tool key and `payload` the
  // original tool arguments. We rebuild the connector's tools WITHOUT a
  // createPendingAction hook so gateWrite() runs the real API call instead of
  // re-queuing the action, then invoke the same tool the agent called.
  const result = await replayConnectorTool(row)
  if (result !== undefined) return result

  throw new Error(`No executor registered for ${row.connector}:${row.action}`)
}

// Meter an approved Composio write executed at replay time. Gated writes never run
// during the agent turn, so the per-turn counter in agent/run.ts can't see them —
// this is where that half of Composio usage gets charged. One replay == one billable
// Composio call. Best-effort and non-blocking: metering must never fail an approval.
export async function meterComposioReplay(
  connector: string,
  userId: string,
  action: string,
): Promise<void> {
  try {
    await import("../connectors/defs/index.js")
    const { getConnectorDef } = await import("../connectors/registry.js")
    if (getConnectorDef(connector)?.auth.kind !== "composio") return

    const { chargeUsage, loadMeteringUser } = await import("./metering.js")
    const user = await loadMeteringUser(userId)
    if (!user) return
    const charge = await chargeUsage({
      user,
      kind: "composio_tool",
      units: 1,
      metadata: { replay: true, action },
    })

    const [{ recordAiUsage }, { composioCostMicros }] = await Promise.all([
      import("./ai-telemetry.js"),
      import("@yomi/shared/ai-pricing"),
    ])
    await recordAiUsage({
      userId,
      requestId: crypto.randomUUID(),
      usageEventId: charge.ok ? charge.usageEventId : null,
      endpoint: "backend.approval",
      surface: "telegram",
      route: "approval.composio",
      provider: "composio",
      toolCalls: 1,
      totalApiCostMicros: composioCostMicros(1),
      creditsCharged: charge.ok ? charge.creditsCharged : 0,
      status: "done",
    })
  } catch {
    // best-effort — a metering hiccup must not break the approval path
  }
}

async function replayConnectorTool(row: {
  userId: string
  connector: string
  action: string
  payload: unknown
}): Promise<unknown | undefined> {
  // Importing the defs index registers every backend ConnectorDef.
  await import("../connectors/defs/index.js")
  const [{ getConnectorDef }, { getAccessToken }] = await Promise.all([
    import("../connectors/registry.js"),
    import("./integration-tokens.js"),
  ])
  const def = getConnectorDef(row.connector)
  if (!def) return undefined

  if (def.isMCPBased && def.connectMCP) {
    const tools = await def.connectMCP({
      userId: row.userId,
      getAccessToken,
    })
    const t = tools[row.action] as
      | { execute?: (args: unknown, opts: unknown) => Promise<unknown> }
      | undefined
    if (!t?.execute) return undefined
    return t.execute(row.payload, { toolCallId: row.action, messages: [] })
  }

  const tools = def.tools({ userId: row.userId, getAccessToken }) as Record<
    string,
    { execute?: (args: unknown, opts: unknown) => Promise<unknown> }
  >
  const t = tools[row.action]
  if (!t?.execute) return undefined
  return t.execute(row.payload, { toolCallId: row.action, messages: [] })
}

export async function denyPendingAction(userId: string, id: string) {
  await expirePendingActions(userId)
  const [row] = await db
    .update(pendingActions)
    .set({ status: "denied", decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingActions.id, id),
        eq(pendingActions.userId, userId),
        eq(pendingActions.status, "pending"),
      ),
    )
    .returning({ id: pendingActions.id, status: pendingActions.status })
  return row ?? null
}

// Human-readable outcome of an executed action: the tool's message plus any
// link it returned (calendar event URL, created doc, GitHub issue, ...).
// Connector tools do not throw on failure — they RETURN { error }. Treating that as
// success reported a calendar event that was never created as "Approved and executed."
export function isErrorResult(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false
  const record = result as Record<string, unknown>
  if (typeof record["error"] === "string") return true
  return record["ok"] === false
}

export function formatActionResult(result: unknown, fallback: string): string {
  const record = (typeof result === "object" && result !== null ? result : {}) as Record<
    string,
    unknown
  >
  if (isErrorResult(record)) {
    const err = typeof record["error"] === "string" ? record["error"] : "the action failed"
    const hint = typeof record["hint"] === "string" ? record["hint"] : null
    return [`That didn't work: ${err}`, hint].filter(Boolean).join("\n")
  }
  const message = typeof record["message"] === "string" ? record["message"] : fallback
  const link =
    typeof record["link"] === "string"
      ? record["link"]
      : typeof record["url"] === "string"
        ? record["url"]
        : typeof record["htmlLink"] === "string"
          ? record["htmlLink"]
          : null
  const meetLink = typeof record["meetLink"] === "string" ? record["meetLink"] : null
  return [message, link, meetLink].filter(Boolean).join("\n")
}

export async function approvePendingAction(
  userId: string,
  id: string,
  opts?: { skipNotify?: boolean },
) {
  await expirePendingActions(userId)
  const [approved] = await db
    .update(pendingActions)
    .set({ status: "approved", decidedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pendingActions.id, id),
        eq(pendingActions.userId, userId),
        eq(pendingActions.status, "pending"),
      ),
    )
    .returning({
      id: pendingActions.id,
      userId: pendingActions.userId,
      connector: pendingActions.connector,
      action: pendingActions.action,
      payload: pendingActions.payload,
      sourcePlatform: pendingActions.sourcePlatform,
      sourceChatId: pendingActions.sourceChatId,
      title: pendingActions.title,
      preview: pendingActions.preview,
    })
  if (!approved) return null

  try {
    const result = await executePendingAction(approved)
    // A tool that returned { error } did not do the thing — recording that as
    // "executed" is how a calendar event that was never created got reported as done.
    const status = isErrorResult(result) ? "failed" : "executed"

    // Meter the Composio call this replay just made (no-op for native connectors).
    // Fire-and-forget so metering never delays or fails the approval response.
    void meterComposioReplay(approved.connector, approved.userId, approved.action)
    const [executed] = await db
      .update(pendingActions)
      .set({ status, result, executedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)))
      .returning({
        id: pendingActions.id,
        status: pendingActions.status,
        result: pendingActions.result,
        title: pendingActions.title,
      })

    if (status === "executed" && approved.connector === "swiggy") {
      try {
        const { upsertMemory } = await import("../routes/memory.js")
        const payload = (approved.payload ?? {}) as Record<string, unknown>

        const now = new Date()
        const dayName = now.toLocaleDateString("en-US", { weekday: "long" })
        const hour = now.getHours()
        const timeOfDay =
          hour >= 5 && hour < 12
            ? "Morning"
            : hour >= 12 && hour < 17
              ? "Afternoon"
              : hour >= 17 && hour < 22
                ? "Evening"
                : "Night"

        if (approved.action === "book_table") {
          const restaurantId = payload.restaurant_id ?? payload.restaurantId
          const dateTime = payload.date_time ?? payload.date ?? payload.datetime
          const partySize = payload.party_size ?? payload.partySize ?? payload.guests
          let bookingDayName: string | undefined
          let bookingTimeOfDay: string | undefined
          if (dateTime) {
            const d = new Date(String(dateTime))
            if (Number.isFinite(d.getTime())) {
              bookingDayName = d.toLocaleDateString("en-US", { weekday: "long" })
              const bh = d.getHours()
              bookingTimeOfDay =
                bh >= 5 && bh < 12
                  ? "Morning"
                  : bh >= 12 && bh < 17
                    ? "Afternoon"
                    : bh >= 17 && bh < 22
                      ? "Evening"
                      : "Night"
            }
          }

          await upsertMemory(approved.userId, {
            kind: "swiggy_order",
            scope: "global",
            topic: restaurantId
              ? `Dineout booking at restaurant ${restaurantId}`
              : "Dineout restaurant booking",
            content: [
              restaurantId ? `Restaurant: ${restaurantId}` : "",
              dateTime ? `Date/Time: ${dateTime}` : "",
              partySize ? `Party size: ${partySize}` : "",
              bookingTimeOfDay ? `Time of day: ${bookingTimeOfDay}` : "",
              bookingDayName ? `Day of week: ${bookingDayName}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            summary: [
              "Dineout reservation",
              restaurantId ? `at ${restaurantId}` : "",
              dateTime ? `on ${dateTime}` : "",
              partySize ? `for ${partySize}` : "",
            ]
              .filter(Boolean)
              .join(" "),
            confidence: 90,
            sourceType: "swiggy_dineout",
          })
        } else if (approved.action === "place_food_order") {
          const restaurantId = payload.restaurant_id ?? payload.restaurantId
          const items = payload.items
          const orderTotal = payload.total ?? payload.order_total
          const itemsSummary = Array.isArray(items)
            ? items
                .map((i: Record<string, unknown>) => {
                  const name = i.name ?? i.dish_name ?? i.id ?? "item"
                  const qty = i.quantity ?? i.qty ?? 1
                  return `${name} x${qty}`
                })
                .join(", ")
            : ""

          await upsertMemory(approved.userId, {
            kind: "swiggy_order",
            scope: "global",
            topic: restaurantId ? `Food order from ${restaurantId}` : "Swiggy food order",
            content: [
              restaurantId ? `Restaurant: ${restaurantId}` : "",
              itemsSummary ? `Items: ${itemsSummary}` : "",
              orderTotal ? `Total: ₹${orderTotal}` : "",
              `Time of day: ${timeOfDay}`,
              `Day of week: ${dayName}`,
            ]
              .filter(Boolean)
              .join("\n"),
            summary: [
              "Food order",
              restaurantId ? `from ${restaurantId}` : "",
              itemsSummary ? `(${itemsSummary})` : "",
              orderTotal ? `₹${orderTotal}` : "",
            ]
              .filter(Boolean)
              .join(" "),
            confidence: 90,
            sourceType: "swiggy_food",
          })
        } else if (approved.action === "checkout") {
          const items = payload.items
          const orderTotal = payload.total ?? payload.order_total
          const itemsSummary = Array.isArray(items)
            ? items
                .map((i: Record<string, unknown>) => {
                  const name = i.name ?? i.product_name ?? i.id ?? "item"
                  const qty = i.quantity ?? i.qty ?? 1
                  return `${name} x${qty}`
                })
                .join(", ")
            : ""

          await upsertMemory(approved.userId, {
            kind: "swiggy_order",
            scope: "global",
            topic: "Instamart order",
            content: [
              itemsSummary ? `Items: ${itemsSummary}` : "",
              orderTotal ? `Total: ₹${orderTotal}` : "",
              `Time of day: ${timeOfDay}`,
              `Day of week: ${dayName}`,
            ]
              .filter(Boolean)
              .join("\n"),
            summary: [
              "Instamart order",
              itemsSummary ? `(${itemsSummary})` : "",
              orderTotal ? `₹${orderTotal}` : "",
            ]
              .filter(Boolean)
              .join(" "),
            confidence: 90,
            sourceType: "swiggy_instamart",
          })
        }
      } catch {
        // best-effort — memory write must not break the approval flow
      }
    }

    // Notify the user on their messaging platform after a write action
    // completes — skipped when the approval came from that same chat and the
    // caller sends its own result reply.
    if (approved.sourcePlatform && approved.sourceChatId && !opts?.skipNotify) {
      // Raw provider results often carry no human `message`/`link` field (e.g.
      // Notion's block/page objects), so formatActionResult falls back to this —
      // reusing the same preview text shown on the approval card (which for
      // Notion actions is a real notion.so link, not just a bare ID) means the
      // "Done" confirmation still surfaces it instead of going silent on it.
      const fallback = approved.preview.trim()
        ? `Done: ${approved.title}\n${approved.preview.trim()}`
        : `Done: ${approved.title}`
      const resultText = formatActionResult(result, fallback)
      import("../gateway/index.js")
        .then(({ getDefaultGateway }) => {
          const gateway = getDefaultGateway()
          const platform = approved.sourcePlatform as "telegram"
          gateway.sendMessage(platform, approved.sourceChatId!, resultText).catch(() => {})
        })
        .catch(() => {})
    }

    return executed ?? { id, status, result, title: approved.title }
  } catch (err) {
    const result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    await db
      .update(pendingActions)
      .set({ status: "failed", result, updatedAt: new Date() })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)))
    throw err
  }
}
