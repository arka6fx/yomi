import { createHash, randomBytes } from "node:crypto"
import { eq, and, lt } from "drizzle-orm"
import { db, platformConnections, linkingCodes, telegramLinkTokens } from "@yomi/db"
import type { PlatformType, GatewayMessage, GatewaySessionInfo } from "@yomi/shared"
import type { AgentMessage } from "@yomi/agent-core"
import type { PlatformAdapter } from "./platform-adapter.js"
import { TelegramAdapter } from "./platforms/telegram.js"
import { runAgent } from "../agent/run.js"
import { transcribeAudioUrl } from "../services/transcription.js"

// Patterns that suggest the user wants the desktop to do something local.
// Keep these narrow — many common words (file, open, screen) appear in data queries too.
const DESKTOP_ACTION_PATTERNS = [
  /\b(click|right.click|double.click|drag\s+(?:and\s+)?drop)\b/i,
  /\b(scroll\s+(?:up|down|left|right)|move\s+(?:the\s+)?(?:cursor|mouse|window))\b/i,
  /\b(minimize|maximize|resize\s+(?:the\s+)?window|close\s+(?:the\s+)?window)\b/i,
  /\b(take\s+a?\s*screenshot|capture\s+(?:my\s+)?screen|screenshot\s+of\s+my)\b/i,
  /\b(analyze\s+(?:my\s+)?screen|look\s+at\s+(?:my\s+)?screen|what(?:'s|\s+is)\s+on\s+(?:my\s+)?screen|check\s+(?:my\s+)?screen)\b/i,
  /\b(press\s+(?:ctrl|alt|shift|win|cmd|enter|escape|tab|f\d+))\b/i,
  /\b(launch\s+(?:the\s+)?app|quit\s+(?:the\s+)?app|open\s+(?:the\s+)?app)\b/i,
  /\b(set\s+(?:the\s+)?volume|mute\s+(?:the\s+)?(?:audio|mic)|play\s+(?:on\s+)?spotify)\b/i,
]

function classifyIntent(text: string): "data-query" | "desktop-action" {
  for (const p of DESKTOP_ACTION_PATTERNS) {
    if (p.test(text)) return "desktop-action"
  }
  return "data-query"
}

const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000
const HISTORY_MAX_TURNS = 8
const HISTORY_TTL_MS = 60 * 60 * 1000

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
  private running = false
  private defaultSidecarUrl: string
  private sidecarSecret: string
  private sidecarResolver: SidecarResolver | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private pendingMessages: Map<string, GatewayMessage[]> = new Map()

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

  setSidecarResolver(resolver: SidecarResolver): void {
    this.sidecarResolver = resolver
  }

  registerAdapter(adapter: PlatformAdapter): void {
    this.adapters.set(adapter.platform, adapter)
    adapter.setMessageHandler((msg) => void this.onIncoming(msg))
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

      // Create platform_connections entry
      const existing = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.platform, "telegram"),
            eq(platformConnections.platformUserId, platformUserId),
          ),
        )
        .limit(1)
        .then((r) => r[0])

      if (existing) {
        console.warn(`[telegram-deeplink] user already linked: yomiUser=${row.userId} telegramUser=${platformUserId}`)
        await this.sendMessage("telegram", chatId, "ℹ️ This Telegram account is already linked to Yomi.")
        return
      }

      await db.insert(platformConnections).values({
        userId: row.userId,
        platform: "telegram",
        platformUserId: platformUserId,
        platformChatId: chatId,
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
      process.env["TELEGRAM_DEEP_LINK_ENABLED"] === "true" &&
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

    // Control commands (/stop /new /help) are handled locally — no LLM needed.
    const controlReply = this.handleControlCommand(msg, session)
    if (controlReply) {
      await this.sendMessage(msg.platform, msg.chatId, controlReply).catch(() => {})
      return
    }

    // ── Voice note transcription ──────────────────────────────────────────────
    if (msg.audioUrl) {
      void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
      try {
        const transcript = await transcribeAudioUrl(msg.audioUrl, msg.audioMimeType ?? "audio/ogg")
        if (!transcript) {
          await this.sendMessage(msg.platform, msg.chatId, "I couldn't make out the audio. Please try again or type your message.").catch(() => {})
          return
        }
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

    // ── Sidecar-first routing ─────────────────────────────────────────────────
    // Try to forward every message to the sidecar when it is online — it runs
    // the optimised fast+agent pipeline with connector tools and low latency.
    // Desktop-only actions (click, type, move, etc.) require the sidecar and
    // show an "open the app" message when it is offline.
    const intent = classifyIntent(msg.text)

    // Keep the typing indicator alive for ANY processing path —
    // Telegram clears it after ~5 s so refresh every 4 s.
    void this.sendTyping(msg.platform, msg.chatId).catch(() => {})
    typingInterval = setInterval(
      () => void this.sendTyping(msg.platform, msg.chatId).catch(() => {}),
      4_000,
    )

    let sidecarUrl: string | undefined
    if (this.sidecarResolver) {
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
        })
        if (res.ok) { clearInterval(typingInterval); return }
        throw new Error(`Sidecar returned ${res.status}`)
      } catch (err) {
        console.warn("[gateway] sidecar forward failed:", err)
        // Fall through to backend agent for data-query; hard-fail for desktop-action
      }
    }

    if (intent === "desktop-action") {
      clearInterval(typingInterval)
      await this.sendMessage(
        msg.platform,
        msg.chatId,
        "That needs your desktop to be online. Open the Yomi app and try again.",
      ).catch(() => {})
      return
    }

    // ── Backend agent path (sidecar offline, data query only) ─────────────────

    const history = this.getHistory(msg.platform, msg.chatId)

    try {
      const result = await runAgent({ userId: yomiUserId, text: msg.text, history })
      clearInterval(typingInterval)
      if (result.text) {
        this.appendHistory(msg.platform, msg.chatId, msg.text, result.text)
      }
      await this.sendMessage(msg.platform, msg.chatId, result.text).catch((err) => {
        console.warn("[gateway] failed to send agent reply:", err)
      })
    } catch (err) {
      clearInterval(typingInterval)
      console.warn("[gateway] runAgent error:", err)
      await this.sendMessage(
        msg.platform,
        msg.chatId,
        "Sorry, I ran into an error. Please try again.",
      ).catch(() => {})
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

  private queueForUser(yomiUserId: string, msg: GatewayMessage): void {
    const queue = this.pendingMessages.get(yomiUserId)
    if (queue) {
      queue.push(msg)
    } else {
      this.pendingMessages.set(yomiUserId, [msg])
    }
  }

  // Sidecar polls this to pull pending messages
  getPendingMessages(yomiUserId: string): GatewayMessage[] {
    const messages = this.pendingMessages.get(yomiUserId)
    if (!messages || messages.length === 0) return []
    this.pendingMessages.delete(yomiUserId)
    return messages
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

  private handleControlCommand(msg: GatewayMessage, _session: GatewaySession): string | null {
    const text = msg.text.trim()

    if (text === "/stop") {
      return "Current operation stopped. How can I help you next?"
    }

    if (text === "/new") {
      _session.messageCount = 0
      _session.createdAt = Date.now()
      _session.lastActivityAt = Date.now()
      this.clearHistory(msg.platform, msg.chatId)
      return "Started a new conversation. How can I help you?"
    }

    if (text === "/approve" || text === "/yes") {
      return "Approval received. (Approval handling depends on the current operation.)"
    }

    if (text === "/deny" || text === "/no") {
      return "Action denied. How else can I help you?"
    }

    if (text === "/help") {
      return (
        "Available commands:\n" +
        "/stop — Stop the current operation\n" +
        "/new — Start a new conversation\n" +
        "/screenshot — Capture and analyse your desktop screen\n" +
        "/voice — Start voice mode on your desktop\n" +
        "/move left|right|up|down — Nudge the Yomi window\n" +
        "/type <text> — Submit a text query to the Yomi desktop\n" +
        "/approve — Approve a pending action\n" +
        "/deny — Deny a pending action\n" +
        "/help — Show this message"
      )
    }

    // Remote desktop trigger commands — return null so they fall through
    // to the sidecar-first routing path which handles them via /gateway/receive.
    if (
      text === "/screenshot" ||
      text === "/voice" ||
      /^\/move\s+(left|right|up|down)$/i.test(text) ||
      /^\/type\s+.+/.test(text)
    ) {
      return null
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
