import { and, desc, eq, lte } from "drizzle-orm"
import { db, pendingActions } from "@yomi/db"

export type PendingActionRisk = "write" | "send" | "paid" | "irreversible"
export type PendingActionStatus = "pending" | "approved" | "denied" | "executed" | "failed" | "expired"

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
  return {
    id: row.id,
    status: row.status,
    message: `Approval required: ${input.title}. Action ID: ${row.id}`,
  }
}

export async function expirePendingActions(userId?: string) {
  const where = userId
    ? and(eq(pendingActions.userId, userId), eq(pendingActions.status, "pending"), lte(pendingActions.expiresAt, new Date()))
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
    .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.status, "pending")))
    .returning({ id: pendingActions.id, status: pendingActions.status })
  return row ?? null
}

export async function approvePendingAction(userId: string, id: string) {
  await expirePendingActions(userId)
  const [approved] = await db
    .update(pendingActions)
    .set({ status: "approved", decidedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId), eq(pendingActions.status, "pending")))
    .returning({
      id: pendingActions.id,
      userId: pendingActions.userId,
      connector: pendingActions.connector,
      action: pendingActions.action,
      payload: pendingActions.payload,
    })
  if (!approved) return null

  try {
    const result = await executePendingAction(approved)
    const [executed] = await db
      .update(pendingActions)
      .set({ status: "executed", result, executedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)))
      .returning({ id: pendingActions.id, status: pendingActions.status, result: pendingActions.result })
    return executed ?? { id, status: "executed", result }
  } catch (err) {
    const result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    await db
      .update(pendingActions)
      .set({ status: "failed", result, updatedAt: new Date() })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.userId, userId)))
    throw err
  }
}
