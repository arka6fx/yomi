import { createHash, randomBytes } from "node:crypto"
import { generateText } from "ai"
import { eq, and, lt } from "drizzle-orm"
import { db, platformConnections, linkingCodes, telegramLinkTokens, usageEvents } from "@yomi/db"
import type { PlatformType, GatewayMessage, GatewaySessionInfo } from "@yomi/shared"
import { checkConsent } from "../services/privacy/checks.js"
import { recordConsentDecision } from "../services/privacy/consent.js"
import { ALLOWED_REACTIONS, createModel, type AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter, InlineButton, PlatformCallbackEvent } from "./platform-adapter.js"
import { TelegramAdapter } from "./platforms/telegram.js"
import { runAgent } from "../agent/run.js"
import {
  appendAgentTurn,
  closeAgentSession,
  getOrCreateAgentSession,
  loadAgentHistory,
} from "../services/agent-sessions.js"
import { transcribeAudioUrl } from "../services/transcription.js"
import { recordAiUsage } from "../services/ai-telemetry.js"
import { consumeCredits, getCreditSummary } from "../services/credit-ledger.js"
import { recordDailyActivity } from "../services/streaks.js"
import { advanceSoulOnboarding } from "../services/soul.js"
import { creditsForUsage, type BillableUsageKind } from "../services/credit-pricing.js"
import { hasBillablePlanAccess, getPlanConfig } from "../entitlements.js"
import { user as userTable } from "../auth-schema.js"

const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000
const HISTORY_MAX_TURNS = 8
const HISTORY_TTL_MS = 60 * 60 * 1000
// Short relative to HISTORY_TTL_MS: a stashed document's payload (up to 50,000 chars)
// is much larger per-entry than a conversation turn, and 15 minutes comfortably
// covers "upload, then ask to index in the same or next couple of messages" without
// holding large payloads in memory indefinitely.
const PENDING_DOCUMENT_TTL_MS = 15 * 60 * 1000
const SHARED_SESSION_PLATFORM = "yomi"
const SHARED_SESSION_CHAT_ID = "global"
const AGENT_TIMEOUT_MESSAGE =
  "That took too long, so I stopped. Please try again, or rephrase your request to make it simpler."

interface LinkingCode {
  platform: PlatformType
  platformUserId: string
  chatId: string | null
  expiresAt: number
}

export interface GatewayStatus {
  running: boolean
  adapters: { platform: PlatformType; connected: boolean; error?: string }[]
  activeSessions: number
}

interface GatewaySession {
  id: string
  platform: PlatformType
  chatId: string
  userId: string
  createdAt: number
  lastActivityAt: number
  messageCount: number
  pendingMessages: GatewayMessage[]
  // The id of the most recent reply still carrying a live "New chat" button, if
  // any — tracked so the next reply can strip it before attaching its own, keeping
  // exactly one live button in the chat at a time instead of one per reply ever sent.
  lastButtonMessageId?: string
}

interface ConversationEntry {
  turns: AgentMessage[]
  lastAt: number
}

interface PendingDocumentEntry {
  title: string
  content: string
  storedAt: number
}

export class GatewayRunner {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map()
  private sessions: Map<string, GatewaySession> = new Map()
  private conversationHistories: Map<string, ConversationEntry> = new Map()
  private pendingDocuments: Map<string, PendingDocumentEntry> = new Map()
  // statusMessageId (when known) lets a New-chat tap on a DIFFERENT message
  // clean up this run's own "Working on it…" placeholder — see handleCallbackQuery's
  // "new" branch, which (unlike "stop") edits the button's own message, not this one.
  private activeRuns: Map<string, { controller: AbortController; statusMessageId?: string }> =
    new Map()
  // Uncharged resumes since the last charged turn, per chat. A resume can propose a
  // further gated write, so approving repeatedly would otherwise fund an unbounded
  // chain of free agent runs off one charged message. Past the cap, resumes are
  // billed like any other turn; a legitimate multi-write task never gets near it.
  private freeResumes: Map<string, number> = new Map()
  private static readonly MAX_FREE_RESUMES = 8
  private running = false
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor() {}

  async verifyLinkingCode(code: string): Promise<LinkingCode | null> {
    try {
      const row = await db
        .select({
          platform: linkingCodes.platform,
          platformUserId: linkingCodes.platformUserId,
          chatId: linkingCodes.platformChatId,
          expiresAt: linkingCodes.expiresAt,
        })
        .from(linkingCodes)
        .where(eq(linkingCodes.code, code.toUpperCase()))
        .limit(1)
        .then((r) => r[0])

      if (!row) return null
      if (Date.now() > row.expiresAt.getTime()) {
        await db.delete(linkingCodes).where(eq(linkingCodes.code, code.toUpperCase()))
        return null
      }

      await db.delete(linkingCodes).where(eq(linkingCodes.code, code.toUpperCase()))

      return {
        platform: row.platform as PlatformType,
        platformUserId: row.platformUserId,
        chatId: row.chatId,
        expiresAt: row.expiresAt.getTime(),
      }
    } catch (err) {
      console.warn("[gateway] verifyLinkingCode error:", err)
      return null
    }
  }

  private async generateLinkingCode(msg: GatewayMessage): Promise<string> {
    const code = randomBytes(3).toString("hex").toUpperCase().slice(0, 6)
    try {
      await db.insert(linkingCodes).values({
        code,
        platform: msg.platform,
        platformUserId: msg.userId,
        platformChatId: msg.chatId,
        expiresAt: new Date(Date.now() + LINK_CODE_TTL_MS),
      })
    } catch (err) {
      console.warn("[gateway] generateLinkingCode insert error:", err)
    }
    return code
  }

  private getLinkingPrompt(code: string): string {
    const appUrl =
      process.env["YOMI_APP_URL"] ??
      process.env["NEXT_PUBLIC_APP_URL"] ??
      process.env["BETTER_AUTH_URL"] ??
      "https://getyomi.in"
    return (
      "Welcome to Yomi! Your account isn't linked yet.\n\n" +
      `Your code: *${code}*\n\n` +
      `Visit ${appUrl}/link and enter this code to connect your account. ` +
      `The code expires in 10 minutes.`
    )
  }

  private async isUserLinked(platform: PlatformType, platformUserId: string): Promise<boolean> {
    try {
      const row = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.platform, platform),
            eq(platformConnections.platformUserId, platformUserId),
          ),
        )
        .limit(1)
        .then((r) => r[0])
      return !!row
    } catch (err) {
      console.warn(`[gateway] isUserLinked DB error:`, err)
      return false
    }
  }

  private historyKey(platform: PlatformType, chatId: string): string {
    return `${platform}:${chatId}`
  }

  private getHistory(platform: PlatformType, chatId: string): AgentMessage[] {
    const key = this.historyKey(platform, chatId)
    const entry = this.conversationHistories.get(key)
    if (!entry || Date.now() - entry.lastAt > HISTORY_TTL_MS) return []
    return entry.turns
  }

  private appendHistory(
    platform: PlatformType,
    chatId: string,
    userText: string,
    assistantText: string,
  ): void {
    const key = this.historyKey(platform, chatId)
    const entry = this.conversationHistories.get(key) ?? { turns: [], lastAt: 0 }
    entry.turns.push({ role: "user", content: userText })
    entry.turns.push({ role: "assistant", content: assistantText })
    if (entry.turns.length > HISTORY_MAX_TURNS * 2) {
      entry.turns = entry.turns.slice(-HISTORY_MAX_TURNS * 2)
    }
    entry.lastAt = Date.now()
    this.conversationHistories.set(key, entry)
  }

  private clearHistory(platform: PlatformType, chatId: string): void {
    this.conversationHistories.delete(this.historyKey(platform, chatId))
  }

  private async formatPendingActions(userId: string): Promise<string> {
    try {
      const { listPendingActions } = await import("../services/pending-actions.js")
      const actions = await listPendingActions(userId)
      if (actions.length === 0) return "No pending approvals."
      const list = actions.map((a) => `${a.title}\n${a.preview}`).join("\n\n")
      return `${list}\n\nReply "yes" to approve the most recent one, or tap Approve/Deny on its message above.`
    } catch (err) {
      console.warn("[gateway] pending approvals unavailable:", err)
      return "Pending approvals are temporarily unavailable. Please try again in a moment."
    }
  }

  // `executed` drives the resume: a gated write is only one step of the agent's
  // plan, so the loop has to be re-entered afterwards or everything the agent
  // meant to do next is lost (the doc got made, the PDF never did).
  private async handleApprovalCommand(
    userId: string,
    text: string,
  ): Promise<{ reply: string; executed: boolean } | null> {
    const trimmed = text.trim()
    const command = trimmed.replace(/^\//, "").trim()
    // A trailing modifier means the user is amending, not approving
    // ("yes but change the time to 7") — those must reach the agent, not approve.
    const hasModifier =
      /\b(but|instead|change|wait|actually|except|hold on|don'?t|do not|no,|rather|make it)\b/i.test(
        command,
      )
    // Standalone affirmatives, or an affirmative followed by the action itself
    // ("yes schedule it", "sure, do that", "ok create it").
    const isAffirmative =
      /^(y|ok(ay)?|kk|yes( please| sir| pls)?|yep|yup|ya|yeah|yah|sure|approve[d]?|confirm(ed)?|accept|send it|do it|go( ahead| for it)?|please do|sounds good|looks good|perfect|correct|right)$/i.test(
        command,
      ) || /^(yes|yeah|yep|yup|sure|ok(ay)?|please|go ahead and|confirm)[,\s]+\S/i.test(command)
    const wantsApprove = !hasModifier && isAffirmative
    const isNegative =
      /^(n|no|nope|nah|deny|denied|reject(ed)?|cancel|stop|don'?t|do not|abort|never mind|nevermind)$/i.test(
        command,
      ) || /^(no|nope|cancel|don'?t|do not)[,\s]+\S/i.test(command)
    const wantsDeny = !wantsApprove && isNegative
    if (/^(pending|approvals|pending approvals)$/i.test(command)) {
      return { reply: await this.formatPendingActions(userId), executed: false }
    }

    if (wantsApprove || wantsDeny) {
      let actions: Awaited<
        ReturnType<(typeof import("../services/pending-actions.js"))["listPendingActions"]>
      >
      let approvePendingAction: (typeof import("../services/pending-actions.js"))["approvePendingAction"]
      let denyPendingAction: (typeof import("../services/pending-actions.js"))["denyPendingAction"]
      let formatActionResult: (typeof import("../services/pending-actions.js"))["formatActionResult"]
      try {
        const pending = await import("../services/pending-actions.js")
        approvePendingAction = pending.approvePendingAction
        denyPendingAction = pending.denyPendingAction
        formatActionResult = pending.formatActionResult
        actions = await pending.listPendingActions(userId)
      } catch (err) {
        console.warn("[gateway] pending approval command unavailable:", err)
        return {
          reply: "Pending approvals are temporarily unavailable. Please try again in a moment.",
          executed: false,
        }
      }
      if (actions.length === 0) return null
      const id = actions[0]!.id
      if (wantsApprove) {
        try {
          const result = await approvePendingAction(userId, id, { skipNotify: true })
          if (!result)
            return {
              reply:
                "I couldn't find that pending action. It may have expired or already been handled.",
              executed: false,
            }
          // A failed action must not read as a success, and must not resume the plan:
          // there is nothing to continue from.
          if (result.status !== "executed")
            return {
              reply: formatActionResult(result.result, `That didn't work: ${result.status}`),
              executed: false,
            }
          return {
            reply: `Approved and executed.\n${formatActionResult(result.result, `Done: ${result.title ?? "action"}`)}`,
            executed: true,
          }
        } catch (err) {
          return {
            reply: `Approval failed: ${err instanceof Error ? err.message : String(err)}`,
            executed: false,
          }
        }
      }
      try {
        const denied = await denyPendingAction(userId, id)
        if (!denied)
          return {
            reply:
              "I couldn't find that pending action. It may have expired or already been handled.",
            executed: false,
          }
        return { reply: "Denied.", executed: false }
      } catch (err) {
        console.warn("[gateway] deny pending action failed:", err)
        return { reply: "Deny failed. Please try again.", executed: false }
      }
    }

    return null
  }

  // Continue the plan an approved write was only one step of. The user already paid
  // for the turn that proposed it, so this run is not charged again.
  private async resumeAfterApproval(
    msg: GatewayMessage,
    yomiUserId: string,
    approvalReply: string,
  ): Promise<void> {
    const key = this.runKey(msg.platform, msg.chatId)
    const used = this.freeResumes.get(key) ?? 0
    const free = used < GatewayRunner.MAX_FREE_RESUMES
    this.freeResumes.set(key, used + 1)

    const controller = new AbortController()
    const timeoutMs = Number(process.env["YOMI_AGENT_RUN_TIMEOUT_MS"] ?? 60_000)
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const result = await runAgent({
        userId: yomiUserId,
        text: `The approved action completed: ${approvalReply}\n\nContinue the request I originally made. If steps remain (for example converting a document to PDF, or applying a label you just created), do them now. If it is already complete, confirm it briefly — do not repeat work that is already done, and do not volunteer links or files from earlier, unrelated requests.`,
        history: this.getHistory(msg.platform, msg.chatId),
        signal: controller.signal,
        sourcePlatform: msg.platform,
        sourceChatId: msg.chatId,
        skipCharge: free,
      })
      const reply = result.text.trim()
      if (!reply) return
      await this.sendMessage(msg.platform, msg.chatId, reply).catch(() => {})
      this.appendHistory(msg.platform, msg.chatId, msg.text, reply)
    } catch (err) {
      // The write itself already succeeded and the user was told so — a failed
      // continuation must not present as a failed action.
      console.warn(
        `[gateway] resume after approval failed user=${yomiUserId} chat=${msg.chatId}:`,
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  private runKey(platform: PlatformType, chatId: string): string {
    return `${platform}:${chatId}`
  }

  // Atomically returns and deletes the conversation's pending document — there is
  // no separate "peek" path, so a repeated or concurrent call within the same turn
  // can't observe and consume the same entry twice.
  private consumePendingDocument(
    platform: PlatformType,
    chatId: string,
  ): { title: string; content: string } | null {
    const key = this.runKey(platform, chatId)
    const entry = this.pendingDocuments.get(key)
    if (!entry || Date.now() - entry.storedAt > PENDING_DOCUMENT_TTL_MS) return null
    this.pendingDocuments.delete(key)
    return { title: entry.title, content: entry.content }
  }

  // Re-inserts a previously-consumed document, used only after a failed index so a
  // transient failure doesn't force the user to re-upload the file to retry. Resets
  // storedAt so the retry gets a fresh TTL window rather than counting down from the
  // original upload time.
  private restorePendingDocument(
    platform: PlatformType,
    chatId: string,
    document: { title: string; content: string },
  ): void {
    this.pendingDocuments.set(this.runKey(platform, chatId), {
      title: document.title,
      content: document.content,
      storedAt: Date.now(),
    })
  }

  // Cheap gpt-5.4-mini path for simple Q&A, greetings, knowledge questions.
  // Returns the reply (plus an optional reaction emoji), or null when the
  // query needs the full agent loop.
  private async fastTelegramRespond(
    text: string,
    history: AgentMessage[],
  ): Promise<{ text: string; reaction: string | null } | null> {
    const modelId =
      process.env["OPENAI_FAST_MODEL"] || process.env["OPENAI_AGENT_MODEL"] || "gpt-5.4-mini"
    try {
      const result = await generateText({
        model: createModel(modelId),
        system:
          "You are Yomi, a helpful AI assistant on Telegram. Answer concisely in 1-3 sentences.\n\n" +
          "Rules:\n" +
          "- Answer directly, no preamble or markdown.\n" +
          "- If the user asks about their email, calendar, files, GitHub, Slack, or any connected service, respond with exactly: NEED_AGENT\n" +
          "- If the user asks you to do something (send, create, draft, schedule, open, deploy), respond with exactly: NEED_AGENT\n" +
          "- If you need to look something up or use a tool, respond with exactly: NEED_AGENT\n" +
          "- If unsure, respond with exactly: NEED_AGENT\n" +
          "- Never use em dashes \u2014 use commas or periods.\n" +
          `- Rarely \u2014 only when it genuinely fits (a clear win, a thanks, a funny moment, a strong yes/no) \u2014 you may react to the user's message. To do so, put a single line "REACT:<emoji>" first, using exactly one of: ${ALLOWED_REACTIONS.join(" ")}. Most replies should have no REACT line at all.`,
        messages: [
          ...history.slice(-4).map((h) => ({
            role: h.role as "user" | "assistant",
            content: h.content,
          })),
          { role: "user", content: text },
        ],
        maxTokens: Math.min(400, Math.max(100, text.length * 1.5)),
        abortSignal: AbortSignal.timeout(5_000),
      })
      let reply = result.text.trim()
      if (!reply || reply === "NEED_AGENT") return null

      let reaction: string | null = null
      const reactMatch = /^REACT:(\S+)\n+([\s\S]*)$/.exec(reply)
      if (reactMatch) {
        const [, emoji, rest] = reactMatch
        if ((ALLOWED_REACTIONS as readonly string[]).includes(emoji!)) reaction = emoji!
        reply = rest!.trim()
      }
      if (!reply) return null
      return { text: reply, reaction }
    } catch {
      return null
    }
  }

  // Photos get one vision call that does double duty: describe the image, and
  // decide whether the caption is a question (DESCRIBE) or a task ("post this",
  // "send it", "save it" — ACTION). ACTION replies get handed to the real agent
  // loop with the uploaded asset's URL, since this method has no connector tools
  // of its own and can only ever describe, never act.
  private async analyzeImage(
    msg: GatewayMessage,
    history: AgentMessage[],
    yomiUserId: string,
  ): Promise<
    | { kind: "describe"; text: string }
    | { kind: "action"; description: string; assetUrl: string | null; publicAssetUrl: string | null }
  > {
    if (!msg.imageUrl)
      return { kind: "describe", text: "I couldn't access the image. Please send it again." }
    const imageRes = await fetch(msg.imageUrl, { signal: AbortSignal.timeout(10_000) })
    if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`)
    // Telegram's own file metadata is authoritative; its file-download CDN often
    // serves a generic content-type (e.g. application/octet-stream) regardless of
    // the file's real type, which would otherwise corrupt the re-hosted asset's
    // extension/content-type and break connectors (e.g. Instagram) that fetch it.
    const contentType = msg.imageMimeType || imageRes.headers.get("content-type") || "image/jpeg"
    const bytes = await imageRes.arrayBuffer()
    if (bytes.byteLength > 8 * 1024 * 1024)
      return {
        kind: "describe",
        text: "That image is too large for me to analyze. Please send a smaller image.",
      }
    const image = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`
    const prompt = msg.text.trim() || "Analyze this image. Keep the answer concise and useful."
    const model = process.env["OPENAI_AGENT_MODEL"] || "gpt-5.5"
    const startedAt = Date.now()

    // Upload happens in parallel with the vision call — it's wasted work on a
    // DESCRIBE caption, but that's cheaper than serializing the two for the
    // common case, and it's a no-op (null) when asset storage isn't configured.
    const assetUploadPromise = (async () => {
      const { uploadAsset } = await import("../services/asset-storage.js")
      return uploadAsset(yomiUserId, bytes, contentType)
    })()

    // Flat budget, not proportional to image byte size — a bigger PNG doesn't need a
    // longer answer, and gpt-5.x's hidden reasoning tokens draw from this same cap
    // (Chat Completions API), so a tight limit on an action-shaped caption ("post this
    // to Instagram...") let reasoning consume the whole budget and leave 0 visible
    // tokens, which read to the user as a silent failure.
    const result = await generateText({
      model: createModel(model),
      system:
        "You are Yomi's image classifier. First line of your reply: exactly ACTION if the " +
        "caption asks you to DO something with the image (post it, send it, save it, upload it, " +
        "share it, or any other task), or exactly DESCRIBE if the caption is just a question about " +
        "the image or there is no caption. Second line onward: for DESCRIBE, a concise, useful " +
        "answer about the image. For ACTION, a short factual description of the image (what it " +
        "shows) — not a reply to the user, this feeds a tool-using agent that will act on it.",
      messages: [
        ...history
          .slice(-8)
          .map((h) => ({ role: h.role as "user" | "assistant" | "system", content: h.content })),
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: prompt },
            { type: "image" as const, image },
          ],
        },
      ],
      maxTokens: 1500,
    })
    recordAiUsage({
      userId: yomiUserId,
      requestId: crypto.randomUUID(),
      endpoint: "gateway.image",
      surface: "telegram",
      route: "gateway",
      model,
      inputTokens: result.usage?.promptTokens,
      outputTokens: result.usage?.completionTokens,
      visionImages: 1,
      latencyMs: Date.now() - startedAt,
      status: "done",
    }).catch(() => {})

    const raw = result.text.trim()
    const isAction = /^ACTION\b/.test(raw)
    const rest = raw.replace(/^(ACTION|DESCRIBE)\s*/, "").trim()

    if (isAction) {
      const asset = await assetUploadPromise.catch((err) => {
        console.warn("[gateway] asset upload failed:", err)
        return null
      })
      return {
        kind: "action",
        description: rest || "an image",
        assetUrl: asset?.url ?? null,
        publicAssetUrl: asset?.publicUrl ?? null,
      }
    }

    // Fire-and-forget: nothing downstream needs the upload for a DESCRIBE reply.
    assetUploadPromise.catch(() => {})
    if (rest) return { kind: "describe", text: rest }
    return {
      kind: "describe",
      text:
        result.finishReason === "length"
          ? "That image needed more thinking than I had room for — try asking a shorter, more specific question about it."
          : "I couldn't produce an image analysis. Please try again.",
    }
  }

  /**
   * Extract text from a document using server-side parsing (pure JS, no native deps).
   * Returns null for unsupported formats or parse failures.
   */
  private async parseDocument(
    bytes: ArrayBuffer,
    contentType: string,
    ext: string | undefined,
    userId: string,
    docName: string,
  ): Promise<string | null> {
    const mime = contentType.toLowerCase()
    const e = ext?.toLowerCase()

    // Plain text
    if (
      mime.includes("text/") ||
      e === "txt" ||
      e === "csv" ||
      e === "md" ||
      e === "json" ||
      e === "xml"
    ) {
      return new TextDecoder().decode(bytes).slice(0, 50_000)
    }

    // HTML
    if (mime.includes("html") || e === "html" || e === "htm") {
      const raw = new TextDecoder().decode(bytes)
      const stripped = raw
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
      return stripped.slice(0, 50_000)
    }

    // PDF and Word docs: convert through the user's Drive (OCR included for
    // PDFs) — no PDF parser fits in the Worker bundle budget.
    const isPdf = mime.includes("pdf") || e === "pdf"
    const isWord =
      mime.includes("wordprocessingml") || mime.includes("msword") || e === "docx" || e === "doc"
    if (isPdf || isWord) {
      try {
        const { extractTextViaDrive } = await import("../services/document-extract.js")
        const sourceMime = isPdf
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return await extractTextViaDrive(userId, bytes, sourceMime, docName)
      } catch (err) {
        console.warn("[gateway] drive document extraction failed:", err)
        return null
      }
    }

    return null
  }

  private async recordGatewayCreditAddon(input: {
    userId: string
    kind: "analyze" | "request_voice"
    amount: number
    reason: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    if (input.amount <= 0) return
    const [event] = await db
      .insert(usageEvents)
      .values({
        userId: input.userId,
        kind: input.kind,
        model:
          input.kind === "analyze"
            ? (process.env["OPENAI_AGENT_MODEL"] ?? "gpt-5.5")
            : "eleven_flash_v2_5",
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        creditsCharged: 0,
        status: "done",
        metadata: { source: "telegram", ...input.metadata },
      })
      .returning({ id: usageEvents.id })
      .catch(() => [])
    if (!event?.id) return

    const debit = await consumeCredits({
      userId: input.userId,
      amount: input.amount,
      usageEventId: event.id,
      idempotencyKey: `telegram-addon:${event.id}:consume`,
      reason: input.reason,
      metadata: { kind: input.kind, source: "telegram", ...input.metadata },
    }).catch(() => null)

    if (debit?.ok) {
      await db
        .update(usageEvents)
        .set({ creditsCharged: debit.charged })
        .where(eq(usageEvents.id, event.id))
        .catch(() => {})
    }
  }

  // Credit gate for the Telegram voice and image surfaces. Credits are the single
  // source of truth: owners bypass, an active plan is required, and the request is
  // blocked when the credit balance can't cover the feature's base cost. The text
  // path is gated inside runAgent (chargeUsage); this closes the gap where
  // voice/image did paid work without a credit check.
  // Returns a user-facing block message, or null when the request may proceed.
  private async featureQuotaBlock(
    yomiUserId: string,
    kind: BillableUsageKind,
    label: string,
  ): Promise<string | null> {
    const [user] = await db
      .select({
        id: userTable.id,
        email: userTable.email,
        role: userTable.role,
        plan: userTable.plan,
        subscriptionStatus: userTable.subscriptionStatus,
        currentPeriodEnd: userTable.currentPeriodEnd,
        trialEndDate: userTable.trialEndDate,
      })
      .from(userTable)
      .where(eq(userTable.id, yomiUserId))
      .limit(1)
    if (!user) return null

    if (!hasBillablePlanAccess(user)) {
      const status = user.subscriptionStatus ?? "inactive"
      return status === "past_due"
        ? "Your payment is past due. Update your payment method to restore access."
        : status === "inactive" && (user.plan ?? "explore") === "explore"
          ? "Your 30-day free trial has ended. Subscribe to Pro or Max to keep using Yomi."
          : "Your subscription is inactive. Visit the dashboard to manage your plan."
    }

    const plan = getPlanConfig(user)
    const cost = creditsForUsage(kind)
    const summary = await getCreditSummary(yomiUserId)
    if (summary.balance < cost) {
      if (plan.key === "explore") {
        return "You're out of trial credits. Subscribe to Pro or Max to keep using Yomi."
      }
      const now = new Date()
      const resetDay = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      ).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
      return `You're out of credits for ${label}. Buy a credit pack to continue. Resets ${resetDay}.`
    }
    return null
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => this.onIncoming(msg))
    adapter.setCallbackHandler((event) => this.handleCallbackQuery(adapter.platform, event))
  }

  async start(_plan?: string): Promise<void> {
    if (this.running) return

    this.running = true
    console.warn("[gateway] starting")

    const telegramToken = process.env["TELEGRAM_BOT_TOKEN"]

    if (telegramToken) {
      const adapter = new TelegramAdapter(telegramToken)
      this.registerAdapter(adapter)
    }

    const adapterList = Array.from(this.adapters.entries())
    const results = await Promise.allSettled(adapterList.map(([, a]) => a.connect()))
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const platform = adapterList[i]?.[0] ?? "unknown"
        console.warn(`[gateway] ${platform} connect failed:`, r.reason)
      }
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupSessions()
      void this.cleanupExpiredCodes()
    }, SESSION_CLEANUP_INTERVAL_MS)

    console.warn(`[gateway] running with ${this.adapters.size} adapter(s)`)
  }

  // ── Telegram deep-link handler ──────────────────────────────────────────────
  // Called when user taps "Start" from a https://t.me/<bot>?start=<token> link.
  // Validates the one-time token and links the Telegram account.

  private async handleTelegramDeepLink(
    token: string,
    platformUserId: string,
    chatId: string,
  ): Promise<void> {
    console.warn(
      `[telegram-deeplink] /start received: token=${token} telegramUser=${platformUserId} chat=${chatId}`,
    )

    try {
      const row = await db
        .select({
          token: telegramLinkTokens.token,
          userId: telegramLinkTokens.userId,
          expiresAt: telegramLinkTokens.expiresAt,
          used: telegramLinkTokens.used,
        })
        .from(telegramLinkTokens)
        .where(eq(telegramLinkTokens.token, token))
        .limit(1)
        .then((r) => r[0])

      if (!row) {
        console.warn(`[telegram-deeplink] token not found: ${token}`)
        await this.sendMessage(
          "telegram",
          chatId,
          "❌ Invalid link. Please reconnect from the Yomi dashboard.",
        )
        return
      }

      if (row.used) {
        console.warn(`[telegram-deeplink] token already used: ${token}`)
        await this.sendMessage(
          "telegram",
          chatId,
          "ℹ️ This link has already been used. Your account may already be connected.",
        )
        return
      }

      if (Date.now() > row.expiresAt.getTime()) {
        console.warn(`[telegram-deeplink] token expired: ${token}`)
        await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.token, token))
        await this.sendMessage(
          "telegram",
          chatId,
          "⏰ Link expired. Please reconnect from the Yomi dashboard.",
        )
        return
      }

      // Mark token as used and record the Telegram user ID
      await db
        .update(telegramLinkTokens)
        .set({ used: true, telegramUserId: platformUserId })
        .where(eq(telegramLinkTokens.token, token))

      // Upsert the platform_connections entry. The user explicitly initiated this
      // link with a fresh token, so always point the Telegram account at the token's
      // Yomi user (re-linking, or moving it to a different account, both work) and
      // refresh the chat id. Keyed on the (platform, platformUserId) unique index.
      await db
        .insert(platformConnections)
        .values({
          userId: row.userId,
          platform: "telegram",
          platformUserId: platformUserId,
          platformChatId: chatId,
        })
        .onConflictDoUpdate({
          target: [platformConnections.platform, platformConnections.platformUserId],
          set: { userId: row.userId, platformChatId: chatId, updatedAt: new Date() },
        })

      // Auto-grant conversation_history and telegram_processing consent so the
      // bot can remember context across messages without a separate dashboard visit.
      await recordConsentDecision({
        userId: row.userId,
        purposes: ["conversation_history", "telegram_processing"],
        status: "granted",
        context: {
          appVersion: null,
          ipAddress: null,
          userAgent: null,
          metadata: { source: "telegram_linking" },
        },
      }).catch((err: unknown) => {
        console.warn("[telegram-deeplink] failed to grant consent:", err)
      })

      console.warn(
        `[telegram-deeplink] link success: yomiUser=${row.userId} telegramUser=${platformUserId} token=${token}`,
      )
      await this.sendMessage(
        "telegram",
        chatId,
        "✅ Telegram successfully linked to your Yomi account.",
      )
    } catch (err) {
      console.warn("[telegram-deeplink] error:", err)
      try {
        await this.sendMessage(
          "telegram",
          chatId,
          "⚠️ An error occurred. Please try again from the Yomi dashboard.",
        )
      } catch {
        /* ignore */
      }
    }
  }

  // ── Telegram deep-link token generator ──────────────────────────────────────
  // Called by the API endpoint to create a one-time use token for Telegram deep linking.

  async createTelegramLinkToken(userId: string): Promise<{ token: string; deepLink: string }> {
    const token = randomBytes(24).toString("hex").slice(0, 32)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    await db.insert(telegramLinkTokens).values({
      token,
      userId,
      expiresAt,
    })

    const adapter = this.adapters.get("telegram") as TelegramAdapter | undefined
    const username =
      adapter?.botUsername ?? process.env["TELEGRAM_BOT_USERNAME"] ?? "yomi_assistant_bot"
    const deepLink = `https://t.me/${username}?start=${token}`

    console.warn(
      `[telegram-deeplink] token created: token=${token} yomiUser=${userId} deepLink=${deepLink}`,
    )
    return { token, deepLink }
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    for (const adapter of this.adapters.values()) {
      try {
        void adapter.disconnect()
      } catch {
        // ignore
      }
    }
    this.adapters.clear()
    this.sessions.clear()
    for (const entry of this.activeRuns.values()) entry.controller.abort()
    this.activeRuns.clear()

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    console.warn("[gateway] stopped")
  }

  isRunning(): boolean {
    return this.running
  }

  getAdapter(platform: PlatformType): PlatformAdapter | undefined {
    return this.adapters.get(platform)
  }

  async sendMessage(
    platform: PlatformType,
    chatId: string,
    text: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.sendMessage(chatId, text, options)
  }

  async deleteMessage(
    platform: PlatformType,
    chatId: string,
    messageId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.deleteMessage(chatId, messageId)
  }

  private async sendMessageAndLog(
    platform: PlatformType,
    chatId: string,
    text: string,
    context: string,
    options?: { replyTo?: string; buttons?: InlineButton[][] },
  ): Promise<string | undefined> {
    const result = await this.sendMessage(platform, chatId, text, options).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    if (!result.ok) {
      console.warn(
        `[gateway] sendMessage failed context=${context} platform=${platform} chat=${chatId}: ${result.error ?? "unknown"}`,
      )
    }
    return "messageId" in result ? result.messageId : undefined
  }

  async sendTyping(platform: PlatformType, chatId: string): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    await adapter.sendTyping(chatId)
  }

  private async clearButtons(
    platform: PlatformType,
    chatId: string,
    messageId: string,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    await adapter.editMessageReplyMarkup(chatId, messageId).catch(() => {})
  }

  async setReaction(
    platform: PlatformType,
    chatId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    const result = await adapter.setReaction(chatId, messageId, emoji).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    if (!result.ok) {
      console.warn(
        `[gateway] setReaction failed platform=${platform} chat=${chatId}: ${result.error ?? "unknown"}`,
      )
    }
  }

  async broadcastMessage(text: string): Promise<void> {
    const adapterList = Array.from(this.adapters.entries())
    const results = await Promise.allSettled(
      adapterList.map(([platform, adapter]) => {
        console.warn(`[gateway] broadcasting to ${platform}`)
        return adapter.sendMessage("broadcast", text)
      }),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!
      if (r.status === "rejected") {
        const platform = adapterList[i]?.[0] ?? "unknown"
        console.warn(`[gateway] broadcast to ${platform} failed:`, r.reason)
      }
    }
  }

  getStatus(): GatewayStatus {
    return {
      running: this.running,
      adapters: Array.from(this.adapters.entries()).map(([platform]) => ({
        platform,
        connected: this.running,
      })),
      activeSessions: this.sessions.size,
    }
  }

  getActiveSessions(): GatewaySessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      platform: s.platform,
      chatId: hashId(s.chatId),
      userId: hashId(s.userId),
      createdAt: new Date(s.createdAt).toISOString(),
      lastActivityAt: new Date(s.lastActivityAt).toISOString(),
      messageCount: s.messageCount,
    }))
  }

  private async onIncoming(msg: GatewayMessage): Promise<void> {
    let typingInterval: ReturnType<typeof setInterval> | undefined
    try {
      console.warn(
        `[gateway] onIncoming platform=${msg.platform} from=${msg.userId} chat=${msg.chatId} text="${msg.text.slice(0, 80)}"`,
      )

      // Telegram deep-link intercept: /start <TOKEN>
      if (msg.platform === "telegram" && msg.text.startsWith("/start ") && msg.text.length > 7) {
        const token = msg.text.slice(7).trim()
        if (token.length >= 16) {
          await this.handleTelegramDeepLink(token, msg.userId, msg.chatId)
          return
        }
      }

      // Prompt unlinked users to connect their account
      if (!msg.userId || msg.userId === "unknown") return
      const linked = await this.isUserLinked(msg.platform, msg.userId)
      console.warn(`[gateway] isUserLinked(${msg.platform}, ${msg.userId}) = ${linked}`)
      if (!linked) {
        const code = await this.generateLinkingCode(msg)
        const adapter = this.adapters.get(msg.platform)
        console.warn(
          `[gateway] unlinked user — generated code=${code} adapter=${adapter ? "found" : "NOT FOUND"}`,
        )
        const result = await adapter?.sendMessage(msg.chatId, this.getLinkingPrompt(code))
        console.warn(`[gateway] linking code send result:`, JSON.stringify(result))
        return
      }

      const yomiUserId = await this.resolveYomiUserId(msg.platform, msg.userId)
      console.warn(
        `[gateway] resolved yomiUserId=${yomiUserId ?? "unknown"} text="${msg.text.slice(0, 60)}"`,
      )
      if (!yomiUserId) return

      // Streaks/leaderboard: counts every message from a linked user, independent
      // of billing/metering — a resumed or skipped-charge turn should still count
      // as "you talked to Yomi today." Best-effort: must never block a reply.
      void recordDailyActivity(yomiUserId).catch((err) => {
        console.error("[gateway] recordDailyActivity failed:", err)
      })

      let conversationConsent = await checkConsent(yomiUserId, "conversation_history").catch(
        () => ({ allowed: true, reason: null, decided: true }),
      )

      // Users who linked Telegram before consent auto-grant existed have no
      // decision rows at all, which made the bot permanently amnesiac for them.
      // Linking already implied consent, so backfill the grant once — but only
      // for purposes the user has never explicitly decided; revocations stand.
      if (!conversationConsent.allowed && !conversationConsent.decided) {
        try {
          const telegramConsent = await checkConsent(yomiUserId, "telegram_processing")
          const purposes: ("conversation_history" | "telegram_processing")[] = [
            "conversation_history",
          ]
          if (!telegramConsent.decided) purposes.push("telegram_processing")
          await recordConsentDecision({
            userId: yomiUserId,
            purposes,
            status: "granted",
            context: {
              appVersion: null,
              ipAddress: null,
              userAgent: null,
              metadata: { source: "telegram_backfill" },
            },
          })
          conversationConsent = { allowed: true, reason: null, decided: true }
          console.warn(`[gateway] backfilled linked-user consent user=${yomiUserId}`)
        } catch (err) {
          console.error("[gateway] consent backfill failed:", err)
        }
      }

      const session = this.getOrCreateSession(msg)
      const isFirstMessage = session.messageCount === 0
      session.messageCount++
      session.lastActivityAt = Date.now()

      // Inform the user once when conversation history is disabled so they know
      // why the bot seems amnesiac instead of failing silently.
      if (!conversationConsent.allowed && isFirstMessage) {
        await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          "ℹ️ Conversation history is currently disabled. I'll respond to each message fresh — I won't remember context between messages. To enable it, visit your dashboard privacy settings.",
          "consent-denied-notice",
        )
      }

      const approval = await this.handleApprovalCommand(yomiUserId, msg.text)
      if (approval) {
        await this.sendMessage(msg.platform, msg.chatId, approval.reply).catch(() => {})
        // Record the exchange so follow-ups ("send me the link") have the
        // executed result in context — approvals used to be invisible to the agent.
        if (conversationConsent.allowed) {
          try {
            const approvalSession = await getOrCreateAgentSession({
              userId: yomiUserId,
              platform: msg.platform,
              chatId: msg.chatId,
            })
            await appendAgentTurn({
              sessionId: approvalSession.id,
              userId: yomiUserId,
              userText: msg.text,
              assistantText: approval.reply,
            })
          } catch (err) {
            console.warn("[gateway] append approval turn failed:", err)
            this.appendHistory(msg.platform, msg.chatId, msg.text, approval.reply)
          }
        } else {
          this.appendHistory(msg.platform, msg.chatId, msg.text, approval.reply)
        }
        // An approved write is one step of a plan, not the end of it: "solve this and
        // give me the PDF" creates the doc, gets approved, and the conversion is still
        // owed. Re-enter the loop so the agent can finish. Nothing more to do if the
        // approval didn't execute (deny, expired, nothing pending).
        if (approval.executed) {
          await this.resumeAfterApproval(msg, yomiUserId, approval.reply)
        }
        return
      }

      // Typed control commands are replaced by inline buttons, but users who still
      // type them by muscle memory (especially /new, and Telegram's own first-run
      // flow which can send a bare /start) must not fall through to the paid agent
      // path. /start <TOKEN> deep-links are handled above and never reach here.
      if (/^\/(stop|new|help|start)$/i.test(msg.text.trim())) {
        await this.sendMessage(
          msg.platform,
          msg.chatId,
          "Use the buttons on my messages — tap Stop, New chat, Approve, or Deny instead of typing commands.",
        ).catch(() => {})
        return
      }

      // ── First-contact personality onboarding ──────────────────────────────────
      // On a user's first off-device message, ask them to define Yomi's personality;
      // their next reply (or "default") is saved per-user and reused thereafter. State
      // is DB-backed so it survives the stateless multi-isolate Workers. Runs before
      // the voice/image/agent branches so onboarding turns never do paid work.
      try {
        const onboardingReply = await advanceSoulOnboarding(yomiUserId, msg.text)
        if (onboardingReply) {
          clearInterval(typingInterval)
          await this.sendMessage(msg.platform, msg.chatId, onboardingReply).catch(() => {})
          return
        }
      } catch (err) {
        // Never block a real message on an onboarding bookkeeping failure.
        console.warn("[gateway] soul onboarding error:", err)
      }

      // ── Voice note transcription ──────────────────────────────────────────────
      if (msg.audioUrl) {
        const voiceBlock = await this.featureQuotaBlock(yomiUserId, "voice", "voice")
        if (voiceBlock) {
          await this.sendMessage(msg.platform, msg.chatId, voiceBlock).catch(() => {})
          return
        }
        void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
        try {
          const transcript = await transcribeAudioUrl(
            msg.audioUrl,
            msg.audioMimeType ?? "audio/ogg",
          )
          if (!transcript) {
            await this.sendMessage(
              msg.platform,
              msg.chatId,
              "I couldn't make out the audio. Please try again or type your message.",
            ).catch(() => {})
            return
          }
          const inputMinutes = Math.max(1, Math.ceil((msg.audioDurationSeconds ?? 60) / 60))
          await this.recordGatewayCreditAddon({
            userId: yomiUserId,
            kind: "request_voice",
            amount: inputMinutes * 2,
            reason: "telegram voice input",
            metadata: { direction: "input", durationSeconds: msg.audioDurationSeconds ?? null },
          })
          recordAiUsage({
            userId: yomiUserId,
            requestId: crypto.randomUUID(),
            endpoint: "gateway.voice",
            surface: "telegram",
            route: "gateway",
            sttAudioSeconds: msg.audioDurationSeconds ?? 0,
            status: "done",
          }).catch(() => {})
          console.warn(`[gateway] voice transcript: "${transcript.slice(0, 100)}"`)
          await this.sendMessage(msg.platform, msg.chatId, `🎙️ _Heard:_ ${transcript}`).catch(
            () => {},
          )
          msg = { ...msg, text: transcript }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          if (errMsg === "STT_RATE_LIMIT") {
            await this.sendMessage(
              msg.platform,
              msg.chatId,
              "Voice transcription paused — please type instead.",
            ).catch(() => {})
          } else {
            console.warn("[gateway] transcription error:", errMsg)
            await this.sendMessage(
              msg.platform,
              msg.chatId,
              "Sorry, I couldn't transcribe the audio. Please type your message.",
            ).catch(() => {})
          }
          return
        }
      }

      // ── Document download context ──────────────────────────────────────────
      if (msg.documentUrl) {
        const docName = msg.documentFileName ?? msg.documentMimeType ?? "document"
        const size = msg.documentSize ? ` (${(msg.documentSize / 1024).toFixed(0)} KB)` : ""
        console.warn(`[gateway] document received: ${docName}${size}`)
        // Download and attempt text extraction — libs (pdf-parse, mammoth) will be
        // The backend tries a basic fetch + LLM fallback.
        try {
          const docRes = await fetch(msg.documentUrl, { signal: AbortSignal.timeout(30_000) })
          if (docRes.ok) {
            const bytes = await docRes.arrayBuffer()
            const contentType = msg.documentMimeType ?? docRes.headers.get("content-type") ?? ""
            const ext = docName.split(".").pop()?.toLowerCase()
            // For common text-based formats, try server-side extraction
            const contentPreview = await this.parseDocument(
              bytes,
              contentType,
              ext,
              yomiUserId,
              docName,
            )
            if (contentPreview) {
              this.pendingDocuments.set(this.runKey(msg.platform, msg.chatId), {
                title: docName,
                content: contentPreview,
                storedAt: Date.now(),
              })
              if (msg.text.trim()) {
                msg = {
                  ...msg,
                  text: `[Document: ${docName}]\n${contentPreview}\n\n---\n${msg.text}`,
                }
              } else {
                msg = { ...msg, text: `[Document: ${docName}]\n${contentPreview}` }
              }
            } else {
              // Fallback: attach URL so the agent's fetch_url or read_document tool can grab it
              const note = docName ? `📄 _File:_ ${docName}` : "📄 _File received_"
              msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
            }
          }
        } catch (err) {
          console.warn("[gateway] document download error:", err)
        }
      }

      // ── Video context ──────────────────────────────────────────────────────
      if (msg.videoUrl) {
        const dur = msg.videoDurationSeconds
          ? ` (${Math.floor(msg.videoDurationSeconds / 60)}:${(msg.videoDurationSeconds % 60).toString().padStart(2, "0")})`
          : ""
        console.warn(`[gateway] video received${dur}`)
        const note = `🎬 _Video received_`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }

      // ── Location context ──────────────────────────────────────────────────
      // No automatic reverse-geocoding here — raw coordinates are already legible
      // to the model, and an eager Maps call on every pin-share would add latency
      // the user didn't ask for. The agent calls the Maps connector's tools
      // itself when it decides the location is relevant to what the user wants.
      if (msg.location) {
        const { latitude, longitude } = msg.location
        console.warn(`[gateway] location received: ${latitude}, ${longitude}`)
        const note = `📍 _Location:_ ${latitude}, ${longitude}`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }

      // ── Sticker context ──────────────────────────────────────────────────
      // React instantly (Telegram's own reaction API only takes emoji from a fixed
      // set, so an off-list sticker emoji falls back to a friendly default), then
      // let the sticker's own emoji/pack name feed into the normal agent turn so
      // the reply itself is a fitting one-liner rather than a flat acknowledgment.
      if (msg.sticker) {
        const stickerEmoji = msg.sticker.emoji
        const reactionEmoji =
          stickerEmoji && (ALLOWED_REACTIONS as readonly string[]).includes(stickerEmoji)
            ? stickerEmoji
            : "😁"
        if (msg.messageId) {
          void this.setReaction(msg.platform, msg.chatId, msg.messageId, reactionEmoji)
        }
        console.warn(`[gateway] sticker received: emoji=${stickerEmoji ?? "?"}`)
        const note = `🧩 _Sticker:_ ${stickerEmoji ?? "unknown"}${msg.sticker.setName ? ` (from "${msg.sticker.setName}")` : ""}`
        msg = { ...msg, text: msg.text.trim() ? `${note}\n${msg.text}` : note }
      }

      // Keep the typing indicator alive for ANY processing path —
      // Telegram clears it after ~5 s so refresh every 4 s. Capped: each ping
      // is a subrequest sharing the invocation budget with the agent's
      // model/tool/DB calls, and losing the indicator beats losing the reply.
      void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
      let typingRefreshes = 0
      typingInterval = setInterval(() => {
        if (++typingRefreshes > 6) {
          clearInterval(typingInterval)
          return
        }
        void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
      }, 4_000)

      // ── Backend agent path ───────────────────────────────────────────────────

      let persistentSession: { id: string } | null = null
      let history = this.getHistory(msg.platform, msg.chatId)

      // Gate the DB read to match the write path: when conversation_history
      // consent is denied, don't load history from the DB so that the read
      // and write paths are consistent — neither reads nor writes persistent
      // history when consent is absent.
      if (conversationConsent.allowed) {
        try {
          persistentSession = await getOrCreateAgentSession({
            userId: yomiUserId,
            platform: SHARED_SESSION_PLATFORM,
            chatId: SHARED_SESSION_CHAT_ID,
          })
          history = await loadAgentHistory(persistentSession.id)
        } catch (err) {
          console.warn("[gateway] persistent session unavailable, using in-memory history:", err)
        }
      }

      if (msg.imageUrl) {
        const analyzeBlock = await this.featureQuotaBlock(yomiUserId, "analyze", "image analysis")
        if (analyzeBlock) {
          clearInterval(typingInterval)
          await this.sendMessage(msg.platform, msg.chatId, analyzeBlock).catch(() => {})
          return
        }
        try {
          const result = await this.analyzeImage(msg, history, yomiUserId)
          await this.recordGatewayCreditAddon({
            userId: yomiUserId,
            kind: "analyze",
            amount: 1,
            reason: "telegram image analysis",
            metadata: { imageMimeType: msg.imageMimeType ?? null },
          })

          if (result.kind === "action") {
            if (!result.assetUrl) {
              clearInterval(typingInterval)
              await this.sendMessageAndLog(
                msg.platform,
                msg.chatId,
                "I can't act on attachments yet — attachment uploads aren't set up on this " +
                  `server. (I can see it's ${result.description}, but can't do anything with it.)`,
                "telegram-image-action-unconfigured",
                { replyTo: msg.messageId },
              )
              return
            }
            // Hand off to the real agent loop below instead of replying here: this
            // method only describes images, it has no connector tools. Rewriting
            // msg.text lets the existing fast-path/agent routing pick this up like
            // any other turn, now with the asset it needs to actually act on.
            msg = {
              ...msg,
              text:
                `${msg.text.trim() ? `${msg.text.trim()}\n\n` : ""}` +
                `[Attached image: ${result.description}. File available at ${result.assetUrl} ` +
                `(expires in 1 hour, ${msg.imageMimeType ?? "image"}).` +
                (result.publicAssetUrl
                  ? ` Stable file URL for image embeds: ${result.publicAssetUrl} ` +
                    `(use it as ![](${result.publicAssetUrl}) for Notion).`
                  : "") +
                `]`,
            }
            // No return — falls through to the fast-path/agent handling below.
          } else {
            if (conversationConsent.allowed && persistentSession) {
              await appendAgentTurn({
                sessionId: persistentSession.id,
                userId: yomiUserId,
                userText: msg.text || "[image]",
                assistantText: result.text,
              }).catch((err) => {
                console.warn("[gateway] append image session failed:", err)
                this.appendHistory(msg.platform, msg.chatId, msg.text || "[image]", result.text)
              })
            } else {
              this.appendHistory(msg.platform, msg.chatId, msg.text || "[image]", result.text)
            }
            clearInterval(typingInterval)
            await this.sendMessageAndLog(
              msg.platform,
              msg.chatId,
              result.text,
              "telegram-image-reply",
              { replyTo: msg.messageId },
            )
            return
          }
        } catch (err) {
          clearInterval(typingInterval)
          console.warn("[gateway] image analysis error:", err)
          await this.sendMessageAndLog(
            msg.platform,
            msg.chatId,
            "Sorry, I couldn't analyze that image. Please try again.",
            "telegram-image-error",
            { replyTo: msg.messageId },
          )
          return
        }
      }

      // ── Fast path: cheap model call for simple Q&A ──────────────────────────
      // Before committing to the full gpt-5.5 agent loop, try gpt-5.4-mini.
      // If the fast path handles it, we save credits and latency.
      const fastReply = await this.fastTelegramRespond(msg.text, history)
      if (fastReply !== null) {
        if (fastReply.reaction && msg.messageId) {
          void this.setReaction(msg.platform, msg.chatId, msg.messageId, fastReply.reaction)
        }
        if (conversationConsent.allowed && persistentSession) {
          await appendAgentTurn({
            sessionId: persistentSession.id,
            userId: yomiUserId,
            userText: msg.text,
            assistantText: fastReply.text,
          }).catch(() => {
            this.appendHistory(msg.platform, msg.chatId, msg.text, fastReply.text)
          })
        } else {
          this.appendHistory(msg.platform, msg.chatId, msg.text, fastReply.text)
        }
        clearInterval(typingInterval)
        await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          fastReply.text,
          "telegram-fast-reply",
          { replyTo: msg.messageId },
        )
        return
      }

      let runController: AbortController | null = null
      let runTimedOut = false
      let runTimeout: ReturnType<typeof setTimeout> | undefined
      let statusMessageId: string | undefined
      try {
        console.warn(
          `[gateway] backend agent start user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId}`,
        )
        runController = new AbortController()
        const runKey = this.runKey(msg.platform, msg.chatId)
        this.activeRuns.set(runKey, { controller: runController })
        // A visible placeholder with a Stop button — this is the one path a user
        // can meaningfully abort (fast/image/voice replies resolve in well under
        // a second, so they never get one). Deleted once the run settles, one way
        // or another, below.
        const statusResult = await this.sendMessage(msg.platform, msg.chatId, "⏳ Working on it…", {
          buttons: [[{ text: "⏹ Stop", callbackData: "stop" }]],
        })
        if (statusResult.ok && statusResult.messageId) {
          statusMessageId = statusResult.messageId
          // Re-set with the status message id now known, so a New-chat tap that
          // races in before runAgent settles can find and delete this placeholder.
          this.activeRuns.set(runKey, { controller: runController, statusMessageId })
        }
        // Hard cap on a single agent run. On a stateless Worker nothing else can
        // abort a hung run (the in-memory /stop and /new controllers live in other
        // isolates), so without this a stuck tool/model call would hang forever.
        const timeoutMs = Number(process.env["YOMI_AGENT_RUN_TIMEOUT_MS"] ?? 60_000)
        runTimeout = setTimeout(() => {
          runTimedOut = true
          runController?.abort()
        }, timeoutMs)
        // A real user turn is charged, so the free-resume allowance starts over.
        this.freeResumes.delete(this.runKey(msg.platform, msg.chatId))
        const result = await runAgent({
          userId: yomiUserId,
          text: msg.text,
          history,
          signal: runController.signal,
          sourcePlatform: msg.platform,
          sourceChatId: msg.chatId,
          onReact: (emoji) =>
            msg.messageId
              ? this.setReaction(msg.platform, msg.chatId, msg.messageId, emoji)
              : Promise.resolve(),
          consumePendingDocument: () => this.consumePendingDocument(msg.platform, msg.chatId),
          restorePendingDocument: (document) =>
            this.restorePendingDocument(msg.platform, msg.chatId, document),
        })
        clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runController.signal.aborted) {
          // A manual Stop tap already edited the status message itself, and a
          // New-chat tap already deleted it (see handleCallbackQuery) — there's
          // nothing further to send in either case. Only a timeout (which
          // neither tap could have caused) still needs to delete the untouched
          // status message and tell the user.
          if (runTimedOut) {
            if (statusMessageId) {
              await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
            }
            await this.sendMessageAndLog(
              msg.platform,
              msg.chatId,
              AGENT_TIMEOUT_MESSAGE,
              "agent-timeout",
            )
          }
          return
        }
        if (statusMessageId) {
          await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
        }
        console.warn(
          `[gateway] backend agent done user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId} chars=${result.text.length}`,
        )
        // Deliver the reply BEFORE persisting history: both compete for the
        // invocation's subrequest budget, and losing the user-visible reply
        // is worse than losing a history write (which has an in-memory fallback).
        const reply = result.text || "I couldn't produce a reply. Please try again."
        // Only one "New chat" button should ever be live at a time — otherwise a tap
        // on an older reply's button silently edits a message that's scrolled out of
        // view, which reads as the button doing nothing. Strip the previous one first.
        if (session.lastButtonMessageId) {
          void this.clearButtons(msg.platform, msg.chatId, session.lastButtonMessageId)
        }
        const newReplyId = await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          reply,
          "backend-agent-reply",
          { buttons: [[{ text: "🔄 New chat", callbackData: "new" }]] },
        )
        session.lastButtonMessageId = newReplyId
        if (result.text) {
          if (conversationConsent.allowed && persistentSession) {
            await appendAgentTurn({
              sessionId: persistentSession.id,
              userId: yomiUserId,
              userText: msg.text,
              assistantText: result.text,
            }).catch((err) => {
              console.warn("[gateway] append persistent session failed:", err)
              this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
            })
          } else {
            this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
          }
        }
      } catch (err) {
        if (runTimeout) clearTimeout(runTimeout)
        clearInterval(typingInterval)
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
        if (runTimedOut) {
          if (statusMessageId) {
            await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
          }
          await this.sendMessageAndLog(
            msg.platform,
            msg.chatId,
            AGENT_TIMEOUT_MESSAGE,
            "agent-timeout",
          )
          return
        }
        // A manual Stop tap already edited the status message itself, and a
        // New-chat tap already deleted it — either way, stop quietly.
        if (runController?.signal.aborted) return
        if (statusMessageId) {
          await this.deleteMessage(msg.platform, msg.chatId, statusMessageId).catch(() => {})
        }
        console.error(
          `[gateway] runAgent error user=${yomiUserId} chat=${msg.chatId}:`,
          err instanceof Error ? (err.stack ?? err.message) : err,
        )
        await this.sendMessageAndLog(
          msg.platform,
          msg.chatId,
          "Sorry, I ran into an error. Please try again.",
          "backend-agent-error",
        )
      }
    } catch (err) {
      clearInterval(typingInterval)
      console.error(
        `[gateway] onIncoming uncaught error platform=${msg.platform} chat=${msg.chatId}:`,
        err instanceof Error ? (err.stack ?? err.message) : err,
      )
      try {
        await this.sendMessage(
          msg.platform,
          msg.chatId,
          "Sorry, something went wrong. Please try again.",
        )
      } catch {
        /* ignore — best-effort */
      }
    }
  }

  // Resolve the Yomi user ID from a platform user ID
  async resolveYomiUserId(
    platform: PlatformType,
    platformUserId: string,
  ): Promise<string | undefined> {
    try {
      const row = await db
        .select({ userId: platformConnections.userId })
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.platform, platform),
            eq(platformConnections.platformUserId, platformUserId),
          ),
        )
        .limit(1)
        .then((r) => r[0])
      return row?.userId
    } catch {
      return undefined
    }
  }

  private async handleCallbackQuery(
    platform: PlatformType,
    event: PlatformCallbackEvent,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return

    const yomiUserId = await this.resolveYomiUserId(platform, event.platformUserId)
    await adapter.answerCallbackQuery(event.callbackId).catch(() => {})
    if (!yomiUserId) return

    if (event.data === "stop") {
      const key = this.runKey(platform, event.chatId)
      const entry = this.activeRuns.get(key)
      if (!entry) {
        await adapter
          .editMessageText(event.chatId, event.messageId, "No operation is currently running.")
          .catch(() => {})
        return
      }
      entry.controller.abort()
      this.activeRuns.delete(key)
      await adapter
        .editMessageText(event.chatId, event.messageId, "Stopping the current operation.")
        .catch(() => {})
      return
    }

    if (event.data === "new") {
      const key = this.runKey(platform, event.chatId)
      const entry = this.activeRuns.get(key)
      if (entry) {
        entry.controller.abort()
        this.activeRuns.delete(key)
        // Unlike "stop" (which edits this same run's own status message), "new"'s
        // button lives on a PREVIOUS turn's reply — the in-flight run's own
        // "Working on it…" placeholder is a different message and would otherwise
        // be left dangling with a dead Stop button forever.
        if (entry.statusMessageId) {
          await this.deleteMessage(platform, event.chatId, entry.statusMessageId).catch(() => {})
        }
      }
      const session = this.sessions.get(`${platform}:${event.chatId}`)
      if (session) {
        session.messageCount = 0
        session.createdAt = Date.now()
        session.lastActivityAt = Date.now()
        // No button is live post-reset until the next reply sends one.
        session.lastButtonMessageId = undefined
      }
      this.clearHistory(platform, event.chatId)
      await closeAgentSession({ userId: yomiUserId, platform, chatId: event.chatId }).catch(
        (err) => {
          console.warn("[gateway] close persistent session failed:", err)
        },
      )
      await closeAgentSession({
        userId: yomiUserId,
        platform: SHARED_SESSION_PLATFORM,
        chatId: SHARED_SESSION_CHAT_ID,
      }).catch((err) => {
        console.warn("[gateway] close shared session failed:", err)
      })
      // Edit the tapped message in place (marks that spot, drops its button) AND
      // send a fresh message — the edit alone is invisible whenever the tapped
      // button lived on a reply that's since scrolled out of view.
      await adapter
        .editMessageText(event.chatId, event.messageId, "✅ Started a new conversation.")
        .catch(() => {})
      await adapter
        .sendMessage(event.chatId, "Started a new conversation. How can I help you?")
        .catch(() => {})
      return
    }

    const approveMatch = /^approve:([0-9a-f-]{36})$/i.exec(event.data)
    if (approveMatch?.[1]) {
      await this.handleCallbackApproval(
        platform,
        event.chatId,
        event.messageId,
        yomiUserId,
        approveMatch[1],
        true,
      )
      return
    }
    const denyMatch = /^deny:([0-9a-f-]{36})$/i.exec(event.data)
    if (denyMatch?.[1]) {
      await this.handleCallbackApproval(
        platform,
        event.chatId,
        event.messageId,
        yomiUserId,
        denyMatch[1],
        false,
      )
    }
  }

  // `executed` drives the resume the same way handleApprovalCommand's text path
  // does: an approved write is one step of the agent's plan, so the loop is
  // re-entered afterwards or everything the agent meant to do next is lost.
  private async handleCallbackApproval(
    platform: PlatformType,
    chatId: string,
    messageId: string,
    yomiUserId: string,
    actionId: string,
    approve: boolean,
  ): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    const { approvePendingAction, denyPendingAction, formatActionResult } =
      await import("../services/pending-actions.js")

    if (!approve) {
      try {
        const denied = await denyPendingAction(yomiUserId, actionId)
        const text = denied
          ? "Denied."
          : "I couldn't find that pending action. It may have expired or already been handled."
        await adapter.editMessageText(chatId, messageId, text).catch(() => {})
      } catch (err) {
        console.warn("[gateway] deny pending action failed:", err)
        await adapter
          .editMessageText(chatId, messageId, "Deny failed. Please try again.")
          .catch(() => {})
      }
      return
    }

    try {
      const result = await approvePendingAction(yomiUserId, actionId, { skipNotify: true })
      if (!result) {
        await adapter
          .editMessageText(
            chatId,
            messageId,
            "I couldn't find that pending action. It may have expired or already been handled.",
          )
          .catch(() => {})
        return
      }
      if (result.status !== "executed") {
        await adapter
          .editMessageText(
            chatId,
            messageId,
            formatActionResult(result.result, `That didn't work: ${result.status}`),
          )
          .catch(() => {})
        return
      }
      const reply = `Approved and executed.\n${formatActionResult(result.result, `Done: ${result.title ?? "action"}`)}`
      await adapter.editMessageText(chatId, messageId, reply).catch(() => {})
      await this.resumeAfterApproval(
        {
          platform,
          chatId,
          userId: "",
          text: "approve",
          timestamp: new Date().toISOString(),
        },
        yomiUserId,
        reply,
      )
    } catch (err) {
      await adapter
        .editMessageText(
          chatId,
          messageId,
          `Approval failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        .catch(() => {})
    }
  }

  async getPendingMessages(yomiUserId: string): Promise<GatewayMessage[]> {
    void yomiUserId
    return []
  }

  private getOrCreateSession(msg: GatewayMessage): GatewaySession {
    const sessionId = `${msg.platform}:${msg.chatId}`
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = {
        id: sessionId,
        platform: msg.platform,
        chatId: msg.chatId,
        userId: msg.userId,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        messageCount: 0,
        pendingMessages: [],
      }
      this.sessions.set(sessionId, session)
    }
    return session
  }

  private async cleanupExpiredCodes(): Promise<void> {
    try {
      await db.delete(linkingCodes).where(lt(linkingCodes.expiresAt, new Date()))
    } catch {
      // ignore
    }
  }

  private cleanupSessions(): void {
    const now = Date.now()
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > SESSION_TTL_MS) {
        this.sessions.delete(id)
      }
    }
    for (const [key, entry] of this.conversationHistories) {
      if (now - entry.lastAt > HISTORY_TTL_MS) {
        this.conversationHistories.delete(key)
      }
    }
    for (const [key, entry] of this.pendingDocuments) {
      if (now - entry.storedAt > PENDING_DOCUMENT_TTL_MS) {
        this.pendingDocuments.delete(key)
      }
    }
  }
}

function hashId(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 12)
}

let defaultGateway: GatewayRunner | null = null

export function getDefaultGateway(): GatewayRunner {
  if (!defaultGateway) defaultGateway = new GatewayRunner()
  return defaultGateway
}
