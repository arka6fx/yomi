import { createHash, randomBytes } from "node:crypto"
import { eq, and, lt } from "drizzle-orm"
import { db, platformConnections, linkingCodes, telegramLinkTokens } from "@yomi/db"
import { usageEvents } from "@yomi/db"
import type { PlatformType, GatewayMessage, GatewaySessionInfo } from "@yomi/shared"
import type { PlatformAdapter } from "./platform-adapter.js"
import { TelegramAdapter } from "./platforms/telegram.js"
import { DiscordAdapter } from "./platforms/discord.js"

const SESSION_TTL_MS = 60 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const LINK_CODE_TTL_MS = 10 * 60 * 1000

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

export class GatewayRunner {
  private adapters: Map<PlatformType, PlatformAdapter> = new Map()
  private sessions: Map<string, GatewaySession> = new Map()
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
      ?? "https://yomi.ai"
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
    const discordToken = process.env["DISCORD_BOT_TOKEN"]

    if (telegramToken) {
      const adapter = new TelegramAdapter(telegramToken)
      this.registerAdapter(adapter)
    }
    if (discordToken) {
      const appId = process.env["DISCORD_CLIENT_ID"]
      const adapter = new DiscordAdapter(discordToken, appId)
      adapter.onLinkCode(async (code, discordUserId, channelId) => {
        await this.handleDiscordLinkCode(code, discordUserId, channelId, adapter)
      })
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

  // ── Discord /link slash command handler ─────────────────────────────────────

  private async handleDiscordLinkCode(
    code: string,
    discordUserId: string,
    channelId: string,
    adapter: DiscordAdapter,
  ): Promise<void> {
    try {
      const row = await db
        .select({
          code: linkingCodes.code,
          platformUserId: linkingCodes.platformUserId,
          userId: linkingCodes.userId,
          expiresAt: linkingCodes.expiresAt,
        })
        .from(linkingCodes)
        .where(
          and(
            eq(linkingCodes.code, code),
            eq(linkingCodes.platform, "discord"),
          ),
        )
        .limit(1)
        .then((r) => r[0])

      if (!row) {
        await adapter.sendMessage(channelId, "❌ Invalid linking code. Generate one from the Yomi dashboard.")
        return
      }

      if (Date.now() > row.expiresAt.getTime()) {
        await db.delete(linkingCodes).where(eq(linkingCodes.code, code))
        await adapter.sendMessage(channelId, "❌ This linking code has expired. Generate a new one from the Yomi dashboard.")
        return
      }

      if (row.platformUserId !== discordUserId) {
        await adapter.sendMessage(channelId, "❌ This code was generated for a different Discord account. Re-authenticate on the dashboard.")
        return
      }

      if (!row.userId) {
        await adapter.sendMessage(channelId, "❌ This code is not associated with a Yomi account. Make sure you're logged in on the dashboard when generating it.")
        return
      }

      // Link the account
      const existing = await db
        .select({ id: platformConnections.id })
        .from(platformConnections)
        .where(
          and(
            eq(platformConnections.platform, "discord"),
            eq(platformConnections.platformUserId, discordUserId),
          ),
        )
        .limit(1)
        .then((r) => r[0])

      if (!existing) {
        await db.insert(platformConnections).values({
          userId: row.userId,
          platform: "discord",
          platformUserId: discordUserId,
          platformChatId: channelId,
        })
      }

      await db.delete(linkingCodes).where(eq(linkingCodes.code, code))

      await adapter.sendMessage(channelId, "✅ Your Discord account is now linked to Yomi! You can now DM the bot from anywhere.")
      console.warn(`[gateway] /link success: yomiUser=${row.userId} discordUser=${discordUserId} code=${code}`)
    } catch (err) {
      console.warn("[gateway] handleDiscordLinkCode error:", err)
      try { await adapter.sendMessage(channelId, "⚠️ An error occurred. Please try again from the Yomi dashboard.") } catch { /* ignore */ }
    }
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
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown")
      console.warn(`[gateway] sidecar forward failed (${res.status}) to ${url}: ${text}`)
    }
  }

  private async onIncoming(msg: GatewayMessage): Promise<void> {
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
    if (msg.userId && msg.userId !== "unknown") {
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
    }

    // Queue message for the linked user's sidecar to poll
    const yomiUserId = await this.resolveYomiUserId(msg.platform, msg.userId)
    console.warn(`[gateway] queueing for yomiUserId=${yomiUserId ?? "unknown"} text="${msg.text.slice(0, 60)}"`)
    if (yomiUserId) {
      this.queueForUser(yomiUserId, msg)
      // Track gateway message usage
      await db.insert(usageEvents).values({
        userId: yomiUserId,
        kind: "gateway_message",
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        status: "done",
      }).catch(() => { /* best-effort */ })
    }

    const session = this.getOrCreateSession(msg)
    session.messageCount++
    session.lastActivityAt = Date.now()
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
        "/approve — Approve a pending action\n" +
        "/deny — Deny a pending action\n" +
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
