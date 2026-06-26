import { createHash, randomBytes } from "node:crypto"
import { generateText } from "ai"
import { eq, and, lt } from "drizzle-orm"
import { db, platformConnections, linkingCodes, telegramLinkTokens, usageEvents } from "@yomi/db"
import type { PlatformType, GatewayMessage, GatewaySessionInfo } from "@yomi/shared"
import { createModel, type AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter } from "./platform-adapter.js"
import { TelegramAdapter } from "./platforms/telegram.js"
import { runAgent } from "../agent/run.js"
import {
  appendAgentTurn,
  closeAgentSession,
  getOrCreateAgentSession,
  loadAgentHistory,
} from "../services/agent-sessions.js"
import { transcribeAudioUrl } from "../services/transcription.js"
import { synthesizeSpeech } from "../services/tts.js"
import { consumeCredits, getCreditSummary } from "../services/credit-ledger.js"
import { advanceSoulOnboarding } from "../services/soul.js"
import { creditsForUsage, type BillableUsageKind } from "../services/credit-pricing.js"
import {
  hasBillablePlanAccess,
  isOwnerUser,
  getPlanConfig,
} from "../entitlements.js"
import { user as userTable } from "../auth-schema.js"

const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000
const HISTORY_MAX_TURNS = 8
const HISTORY_TTL_MS = 60 * 60 * 1000
const SHARED_SESSION_PLATFORM = "yomi"
const SHARED_SESSION_CHAT_ID = "global"
const AGENT_TIMEOUT_MESSAGE =
  "That took too long, so I stopped. Please try again, or rephrase your request to make it simpler."

function directSidecarEnabled(): boolean {
  return process.env["YOMI_GATEWAY_DIRECT_SIDECAR"] === "1"
}

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
}

export type SidecarResolver = (
  userId: string,
  platform: PlatformType,
) => string | undefined | Promise<string | undefined>

interface ConversationEntry {
  turns: AgentMessage[]
  lastAt: number
}

export class GatewayRunner {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map()
  private sessions: Map<string, GatewaySession> = new Map()
  private conversationHistories: Map<string, ConversationEntry> = new Map()
  private activeRuns: Map<string, AbortController> = new Map()
  private running = false
  private defaultSidecarUrl: string
  private sidecarSecret: string
  private sidecarResolver: SidecarResolver | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(sidecarUrl?: string, sidecarSecret?: string) {
    this.defaultSidecarUrl = sidecarUrl ?? process.env["SIDECAR_URL"] ?? "http://localhost:3002"
    this.sidecarSecret = sidecarSecret ?? process.env["SIDECAR_SECRET"] ?? ""
  }

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
    const appUrl = process.env["YOMI_APP_URL"]
      ?? process.env["NEXT_PUBLIC_APP_URL"]
      ?? process.env["BETTER_AUTH_URL"]
      ?? "https://yomi.arka6fx.com"
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

  private appendHistory(platform: PlatformType, chatId: string, userText: string, assistantText: string): void {
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
      return actions
        .map((a) => `${a.id}\n${a.title}\n${a.preview}\nReply: approve ${a.id} or deny ${a.id}`)
        .join("\n\n")
    } catch (err) {
      console.warn("[gateway] pending approvals unavailable:", err)
      return "Pending approvals are temporarily unavailable. Please try again in a moment."
    }
  }

  private async handleApprovalCommand(userId: string, text: string): Promise<string | null> {
    const trimmed = text.trim()
    const command = trimmed.replace(/^\//, "")
    if (/^(pending|approvals|pending approvals)$/i.test(command)) {
      return this.formatPendingActions(userId)
    }

    if (/^(approve|yes|deny|no)$/i.test(command)) {
      let actions: Awaited<ReturnType<typeof import("../services/pending-actions.js")["listPendingActions"]>>
      let approvePendingAction: typeof import("../services/pending-actions.js")["approvePendingAction"]
      let denyPendingAction: typeof import("../services/pending-actions.js")["denyPendingAction"]
      try {
        const pending = await import("../services/pending-actions.js")
        approvePendingAction = pending.approvePendingAction
        denyPendingAction = pending.denyPendingAction
        actions = await pending.listPendingActions(userId)
      } catch (err) {
        console.warn("[gateway] pending approval command unavailable:", err)
        return "Pending approvals are temporarily unavailable. Please try again in a moment."
      }
      if (actions.length === 0) return "No pending approvals."
      if (actions.length > 1) return await this.formatPendingActions(userId)
      const id = actions[0]!.id
      if (/^(approve|yes)$/i.test(command)) {
        try {
          const result = await approvePendingAction(userId, id)
          if (!result) return "I couldn't find that pending action. It may have expired or already been handled."
          return result.status === "executed" ? "Approved and executed." : `Approved: ${result.status}`
        } catch (err) {
          return `Approval failed: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      try {
        const denied = await denyPendingAction(userId, id)
        if (!denied) return "I couldn't find that pending action. It may have expired or already been handled."
        return "Denied."
      } catch (err) {
        console.warn("[gateway] deny pending action failed:", err)
        return "Deny failed. Please try again."
      }
    }

    const match = /^(?:\/)?(approve|confirm|send|deny|reject|cancel)\s+([0-9a-f-]{36})$/i.exec(trimmed)
    if (!match) return null
    const actionCommand = match[1]?.toLowerCase()
    const id = match[2]
    if (!actionCommand || !id) return null

    if (actionCommand === "approve" || actionCommand === "confirm" || actionCommand === "send") {
      try {
        const { approvePendingAction } = await import("../services/pending-actions.js")
        const result = await approvePendingAction(userId, id)
        if (!result) return "I couldn't find that pending action. It may have expired or already been handled."
        return result.status === "executed" ? "Approved and executed." : `Approved: ${result.status}`
      } catch (err) {
        return `Approval failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }

    try {
      const { denyPendingAction } = await import("../services/pending-actions.js")
      const denied = await denyPendingAction(userId, id)
      if (!denied) return "I couldn't find that pending action. It may have expired or already been handled."
      return "Denied."
    } catch (err) {
      console.warn("[gateway] deny pending action failed:", err)
      return "Deny failed. Please try again."
    }
  }

  private runKey(platform: PlatformType, chatId: string): string {
    return `${platform}:${chatId}`
  }

  private wantsVoiceReply(text: string): boolean {
    return /\b(voice reply|reply in voice|send (me )?(a )?(voice|voicemail|voice note|audio)|say it aloud|read it out)\b/i.test(text)
  }

  private async analyzeImage(msg: GatewayMessage, history: AgentMessage[]): Promise<string> {
    if (!msg.imageUrl) return "I couldn't access the image. Please send it again."
    const imageRes = await fetch(msg.imageUrl, { signal: AbortSignal.timeout(10_000) })
    if (!imageRes.ok) throw new Error(`Failed to download image: ${imageRes.status}`)
    const contentType = imageRes.headers.get("content-type") || msg.imageMimeType || "image/jpeg"
    const bytes = await imageRes.arrayBuffer()
    if (bytes.byteLength > 8 * 1024 * 1024) return "That image is too large for me to analyze. Please send a smaller image."
    const image = `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`
    const prompt = msg.text.trim() || "Analyze this image. Keep the answer concise and useful."
    const result = await generateText({
      model: createModel(process.env["AI_CREDITS_AGENT_MODEL"] || "gpt-5.5"),
      system: "You are Yomi. Analyze the image and answer concisely. If the user asks for details, include only the useful details.",
      messages: [
        ...history.slice(-8).map((h) => ({ role: h.role as "user" | "assistant" | "system", content: h.content })),
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: prompt },
            { type: "image" as const, image },
          ],
        },
      ],
      maxTokens: 420,
    })
    return result.text.trim() || "I couldn't produce an image analysis. Please try again."
  }

  private async sendVoiceReplyIfRequested(msg: GatewayMessage, text: string, yomiUserId: string): Promise<boolean> {
    if (msg.platform !== "telegram" || !this.wantsVoiceReply(msg.text)) return false
    const adapter = this.adapters.get("telegram")
    if (!(adapter instanceof TelegramAdapter)) return false
    const spokenText = text.replace(/https?:\/\/\S+/g, "").slice(0, 1200).trim()
    if (!spokenText) return false
    try {
      const audio = await synthesizeSpeech(spokenText)
      const result = await adapter.sendVoice(msg.chatId, audio.audio, {
        replyTo: msg.messageId,
        caption: text.length > 500 ? text.slice(0, 500) : undefined,
      })
      if (!result.ok) console.warn(`[gateway] telegram voice send failed: ${result.error ?? "unknown"}`)
      if (result.ok) {
        const estimatedMinutes = Math.max(1, Math.ceil(spokenText.length / 900))
        await this.recordGatewayCreditAddon({
          userId: yomiUserId,
          kind: "request_voice",
          amount: estimatedMinutes * 2,
          reason: "telegram voice reply",
          metadata: { direction: "output", estimatedMinutes },
        })
      }
      return result.ok
    } catch (err) {
      console.warn("[gateway] telegram voice synthesis failed:", err)
      return false
    }
  }

  private async recordGatewayCreditAddon(input: {
    userId: string
    kind: "analyze" | "request_voice"
    amount: number
    reason: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    if (input.amount <= 0) return
    const [event] = await db.insert(usageEvents).values({
      userId: input.userId,
      kind: input.kind,
      model: input.kind === "analyze" ? process.env["AI_CREDITS_AGENT_MODEL"] ?? "gpt-5.5" : "eleven_flash_v2_5",
      inputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      creditsCharged: 0,
      status: "done",
      metadata: { source: "telegram", ...input.metadata },
    }).returning({ id: usageEvents.id }).catch(() => [])
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
      await db.update(usageEvents).set({ creditsCharged: debit.charged }).where(eq(usageEvents.id, event.id)).catch(() => {})
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
    if (isOwnerUser(user)) return null

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
      const resetDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
        .toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
      return `You're out of credits for ${label}. Buy a credit pack to continue. Resets ${resetDay}.`
    }
    return null
  }

  setSidecarResolver(resolver: SidecarResolver): void {
    this.sidecarResolver = resolver
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => this.onIncoming(msg))
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
    const results = await Promise.allSettled(
      adapterList.map(([, a]) => a.connect()),
    )
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

  private async handleTelegramDeepLink(token: string, platformUserId: string, chatId: string): Promise<void> {
    console.warn(`[telegram-deeplink] /start received: token=${token} telegramUser=${platformUserId} chat=${chatId}`)

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
        await this.sendMessage("telegram", chatId, "❌ Invalid link. Please reconnect from the Yomi dashboard.")
        return
      }

      if (row.used) {
        console.warn(`[telegram-deeplink] token already used: ${token}`)
        await this.sendMessage("telegram", chatId, "ℹ️ This link has already been used. Your account may already be connected.")
        return
      }

      if (Date.now() > row.expiresAt.getTime()) {
        console.warn(`[telegram-deeplink] token expired: ${token}`)
        await db.delete(telegramLinkTokens).where(eq(telegramLinkTokens.token, token))
        await this.sendMessage("telegram", chatId, "⏰ Link expired. Please reconnect from the Yomi dashboard.")
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

      console.warn(`[telegram-deeplink] link success: yomiUser=${row.userId} telegramUser=${platformUserId} token=${token}`)
      await this.sendMessage("telegram", chatId, "✅ Telegram successfully linked to your Yomi account.")
    } catch (err) {
      console.warn("[telegram-deeplink] error:", err)
      try { await this.sendMessage("telegram", chatId, "⚠️ An error occurred. Please try again from the Yomi dashboard.") } catch { /* ignore */ }
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
    const username = adapter?.botUsername ?? process.env["TELEGRAM_BOT_USERNAME"] ?? "yomi_assistant_bot"
    const deepLink = `https://t.me/${username}?start=${token}`

    console.warn(`[telegram-deeplink] token created: token=${token} yomiUser=${userId} deepLink=${deepLink}`)
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
    for (const controller of this.activeRuns.values()) controller.abort()
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
    options?: { replyTo?: string },
  ): Promise<{ ok: boolean; messageId?: string; error?: string }> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return { ok: false, error: `platform "${platform}" not connected` }
    return adapter.sendMessage(chatId, text, options)
  }

  private async sendMessageAndLog(
    platform: PlatformType,
    chatId: string,
    text: string,
    context: string,
    options?: { replyTo?: string },
  ): Promise<void> {
    const result = await this.sendMessage(platform, chatId, text, options).catch((err) => ({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }))
    if (!result.ok) {
      console.warn(`[gateway] sendMessage failed context=${context} platform=${platform} chat=${chatId}: ${result.error ?? "unknown"}`)
    }
  }

  async sendTyping(platform: PlatformType, chatId: string): Promise<void> {
    const adapter = this.adapters.get(platform)
    if (!adapter) return
    await adapter.sendTyping(chatId)
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

  async sendToSidecar(msg: GatewayMessage): Promise<void> {
    let url = this.defaultSidecarUrl
    if (msg.userId && msg.userId !== "unknown" && this.sidecarResolver) {
      const resolved = await this.sidecarResolver(msg.userId, msg.platform)
      if (resolved) url = resolved
    }

    const res = await fetch(`${url}/gateway/receive`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.sidecarSecret}`,
      },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(4_000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown")
      console.warn(`[gateway] sidecar forward failed (${res.status}) to ${url}: ${text}`)
    }
  }

  private async onIncoming(msg: GatewayMessage): Promise<void> {
    let typingInterval: ReturnType<typeof setInterval> | undefined
    try {
      console.warn(`[gateway] onIncoming platform=${msg.platform} from=${msg.userId} chat=${msg.chatId} text="${msg.text.slice(0, 80)}"`)

    // Telegram deep-link intercept: /start <TOKEN>
    if (
      msg.platform === "telegram" &&
      msg.text.startsWith("/start ") &&
      msg.text.length > 7
    ) {
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
      console.warn(`[gateway] unlinked user — generated code=${code} adapter=${adapter ? "found" : "NOT FOUND"}`)
      const result = await adapter?.sendMessage(msg.chatId, this.getLinkingPrompt(code))
      console.warn(`[gateway] linking code send result:`, JSON.stringify(result))
      return
    }

    const yomiUserId = await this.resolveYomiUserId(msg.platform, msg.userId)
    console.warn(`[gateway] resolved yomiUserId=${yomiUserId ?? "unknown"} text="${msg.text.slice(0, 60)}"`)
    if (!yomiUserId) return

    const session = this.getOrCreateSession(msg)
    session.messageCount++
    session.lastActivityAt = Date.now()

    const approvalReply = await this.handleApprovalCommand(yomiUserId, msg.text)
    if (approvalReply) {
      await this.sendMessage(msg.platform, msg.chatId, approvalReply).catch(() => {})
      return
    }

    // Control commands (/stop /new /help) are handled locally — no LLM needed.
    const controlReply = await this.handleControlCommand(msg, session, yomiUserId)
    if (controlReply) {
      await this.sendMessage(msg.platform, msg.chatId, controlReply).catch(() => {})
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
        const transcript = await transcribeAudioUrl(msg.audioUrl, msg.audioMimeType ?? "audio/ogg")
        if (!transcript) {
          await this.sendMessage(msg.platform, msg.chatId, "I couldn't make out the audio. Please try again or type your message.").catch(() => {})
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
        console.warn(`[gateway] voice transcript: "${transcript.slice(0, 100)}"`)
        // Show transcript so user can see what was heard
        await this.sendMessage(msg.platform, msg.chatId, `🎙️ _Heard:_ ${transcript}`).catch(() => {})
        msg = { ...msg, text: transcript }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (errMsg === "STT_RATE_LIMIT") {
          await this.sendMessage(msg.platform, msg.chatId, "Voice transcription paused — please type instead.").catch(() => {})
        } else {
          console.warn("[gateway] transcription error:", errMsg)
          await this.sendMessage(msg.platform, msg.chatId, "Sorry, I couldn't transcribe the audio. Please type your message.").catch(() => {})
        }
        return
      }
    }

    // ── Backend-first routing ─────────────────────────────────────────────────
    // Production messaging runs in the backend so Telegram is not coupled to a
    // user's localhost sidecar. Direct sidecar forwarding is only for explicit
    // dev/tunnel setups.

    // Keep the typing indicator alive for ANY processing path —
    // Telegram clears it after ~5 s so refresh every 4 s.
    void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
    typingInterval = setInterval(
      () => void this.sendTyping(msg.platform, msg.chatId).catch(() => {}),
      4_000,
    )

    let sidecarUrl: string | undefined
    if (directSidecarEnabled() && this.sidecarResolver) {
      sidecarUrl = await this.sidecarResolver(yomiUserId, msg.platform)
    }

    if (sidecarUrl) {
      try {
        const res = await fetch(`${sidecarUrl}/gateway/receive`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.sidecarSecret}`,
          },
          body: JSON.stringify({ ...msg, yomiUserId }),
          signal: AbortSignal.timeout(4_000),
        })
        if (res.ok) {
          console.warn(`[gateway] forwarded to sidecar platform=${msg.platform} user=${yomiUserId} chat=${msg.chatId}`)
          clearInterval(typingInterval)
          return
        }
        const body = await res.text().catch(() => "")
        throw new Error(`Sidecar returned ${res.status}: ${body.slice(0, 200)}`)
      } catch (err) {
        console.warn("[gateway] sidecar forward failed:", err)
        // Fall through to backend agent.
      }
    }

    // ── Backend agent path ───────────────────────────────────────────────────

    let persistentSession: { id: string } | null = null
    let history = this.getHistory(msg.platform, msg.chatId)

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

    if (msg.imageUrl) {
      const analyzeBlock = await this.featureQuotaBlock(yomiUserId, "analyze", "image analysis")
      if (analyzeBlock) {
        clearInterval(typingInterval)
        await this.sendMessage(msg.platform, msg.chatId, analyzeBlock).catch(() => {})
        return
      }
      try {
        const imageReply = await this.analyzeImage(msg, history)
        await this.recordGatewayCreditAddon({
          userId: yomiUserId,
          kind: "analyze",
          amount: 1,
          reason: "telegram image analysis",
          metadata: { imageMimeType: msg.imageMimeType ?? null },
        })
        if (persistentSession) {
          await appendAgentTurn({
            sessionId: persistentSession.id,
            userId: yomiUserId,
            userText: msg.text || "[image]",
            assistantText: imageReply,
          }).catch((err) => {
            console.warn("[gateway] append image session failed:", err)
            this.appendHistory(msg.platform, msg.chatId, msg.text || "[image]", imageReply)
          })
        } else {
          this.appendHistory(msg.platform, msg.chatId, msg.text || "[image]", imageReply)
        }
        clearInterval(typingInterval)
        if (!(await this.sendVoiceReplyIfRequested(msg, imageReply, yomiUserId))) {
          await this.sendMessageAndLog(msg.platform, msg.chatId, imageReply, "telegram-image-reply", { replyTo: msg.messageId })
        }
      } catch (err) {
        clearInterval(typingInterval)
        console.warn("[gateway] image analysis error:", err)
        await this.sendMessageAndLog(msg.platform, msg.chatId, "Sorry, I couldn't analyze that image. Please try again.", "telegram-image-error", { replyTo: msg.messageId })
      }
      return
    }

    let runController: AbortController | null = null
    let runTimedOut = false
    let runTimeout: ReturnType<typeof setTimeout> | undefined
    try {
      console.warn(`[gateway] backend agent start user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId}`)
      runController = new AbortController()
      this.activeRuns.set(this.runKey(msg.platform, msg.chatId), runController)
      // Hard cap on a single agent run. On a stateless Worker nothing else can
      // abort a hung run (the in-memory /stop and /new controllers live in other
      // isolates), so without this a stuck tool/model call would hang forever.
      const timeoutMs = Number(process.env["YOMI_AGENT_RUN_TIMEOUT_MS"] ?? 60_000)
      runTimeout = setTimeout(() => {
        runTimedOut = true
        runController?.abort()
      }, timeoutMs)
      const result = await runAgent({
        userId: yomiUserId,
        text: msg.text,
        history,
        signal: runController.signal,
        sourcePlatform: msg.platform,
        sourceChatId: msg.chatId,
      })
      clearTimeout(runTimeout)
      clearInterval(typingInterval)
      this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
      if (runController.signal.aborted) {
        if (runTimedOut) {
          await this.sendMessageAndLog(msg.platform, msg.chatId, AGENT_TIMEOUT_MESSAGE, "agent-timeout")
        }
        return
      }
      if (result.text) {
        if (persistentSession) {
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
      console.warn(`[gateway] backend agent done user=${yomiUserId} platform=${msg.platform} chat=${msg.chatId} chars=${result.text.length}`)
      const reply = result.text || "I couldn't produce a reply. Please try again."
      if (!(await this.sendVoiceReplyIfRequested(msg, reply, yomiUserId))) {
        await this.sendMessageAndLog(msg.platform, msg.chatId, reply, "backend-agent-reply")
      }
    } catch (err) {
      if (runTimeout) clearTimeout(runTimeout)
      clearInterval(typingInterval)
      this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
      if (runTimedOut) {
        await this.sendMessageAndLog(msg.platform, msg.chatId, AGENT_TIMEOUT_MESSAGE, "agent-timeout")
        return
      }
      if (runController?.signal.aborted) return
      console.warn("[gateway] runAgent error:", err)
      await this.sendMessageAndLog(
        msg.platform,
        msg.chatId,
        "Sorry, I ran into an error. Please try again.",
        "backend-agent-error",
      )
    }
    } catch (err) {
      clearInterval(typingInterval)
      console.warn("[gateway] onIncoming uncaught error:", err)
      try {
        await this.sendMessage(
          msg.platform,
          msg.chatId,
          "Sorry, something went wrong. Please try again.",
        )
      } catch { /* ignore — best-effort */ }
    }
  }

  // Resolve the Yomi user ID from a platform user ID
  async resolveYomiUserId(platform: PlatformType, platformUserId: string): Promise<string | undefined> {
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

  // Kept for backward compatibility with released sidecars. Telegram no longer
  // queues desktop-trigger messages here; backend handles messaging directly.
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

  private async handleControlCommand(msg: GatewayMessage, _session: GatewaySession, yomiUserId: string): Promise<string | null> {
    const text = msg.text.trim()

    if (text === "/stop") {
      const controller = this.activeRuns.get(this.runKey(msg.platform, msg.chatId))
      if (!controller) return "No operation is currently running."
      controller.abort()
      this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
      return "Stopping the current operation."
    }

    if (text === "/new") {
      const controller = this.activeRuns.get(this.runKey(msg.platform, msg.chatId))
      if (controller) {
        controller.abort()
        this.activeRuns.delete(this.runKey(msg.platform, msg.chatId))
      }
      _session.messageCount = 0
      _session.createdAt = Date.now()
      _session.lastActivityAt = Date.now()
      this.clearHistory(msg.platform, msg.chatId)
      await closeAgentSession({ userId: yomiUserId, platform: msg.platform, chatId: msg.chatId }).catch((err) => {
        console.warn("[gateway] close persistent session failed:", err)
      })
      await closeAgentSession({ userId: yomiUserId, platform: SHARED_SESSION_PLATFORM, chatId: SHARED_SESSION_CHAT_ID }).catch((err) => {
        console.warn("[gateway] close shared session failed:", err)
      })
      return "Started a new conversation. How can I help you?"
    }

    if (text === "/start") {
      return "Yomi is connected. Send a message, voice note, or /help to see available commands."
    }

    if (text === "/help") {
      return (
        "Available commands:\n" +
        "/new — Start a new conversation\n" +
        "/stop — Stop the current operation\n" +
        "/pending — Show pending approvals\n" +
        "/approve — Approve the only pending action, or show choices\n" +
        "/deny — Deny the only pending action, or show choices\n" +
        "/help — Show this message"
      )
    }

    return null
  }

  private async cleanupExpiredCodes(): Promise<void> {
    try {
      await db.delete(linkingCodes).where(
        lt(linkingCodes.expiresAt, new Date()),
      )
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
