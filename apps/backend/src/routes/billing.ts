import { Hono } from "hono"
import { createHmac, timingSafeEqual } from "node:crypto"
import { db, paymentRecords, usageEvents } from "@yomi/db"
import { and, eq, gte, inArray, sql } from "drizzle-orm"
import { authenticate } from "../auth.js"
import * as authSchema from "../auth-schema.js"
import {
  effectivePlanForUser,
  effectiveRoleForUser,
  featureLimitForUser,
  requestLimitForUser,
} from "../entitlements.js"
import {
  CREDIT_PACKS,
  PLANS as SHARED_PLANS,
  getCreditPack,
  getPlan,
  type PlanKey,
} from "@yomi/shared/plans"
import {
  createPaymentRecord,
  getCreditSummary,
  grantCredits,
  recentCreditTransactions,
} from "../services/credit-ledger.js"
import { listConnectedProviders } from "../services/integration-tokens.js"
import { payloadHash, recordPaymentEvent, upsertPaymentRecord } from "../services/payment-events.js"

type DodoMode = "test" | "live"

function dodoMode(): DodoMode {
  const raw = process.env["DODO_ENV"] ?? ""
  const mode = raw.toLowerCase()
  if (mode === "live") return "live"
  if (raw && mode !== "test") {
    console.warn("[yomi/dodo] WARNING: DODO_ENV=" + raw + " is invalid; defaulting to test")
  }
  return "test"
}

type DodoConfig = {
  mode: DodoMode
  apiBase: string
  apiKey: string | null
  webhookSecret: string | null
  productIds: Partial<Record<PlanKey | string, string | null>>
}

export function getDodoConfig(): DodoConfig {
  const mode = dodoMode()
  const prefix = mode === "live" ? "DODO_LIVE" : "DODO_TEST"

  function read(key: string): string | null {
    const selected = process.env[`${prefix}_${key}`]
    if (selected !== undefined) return selected || null

    const legacy = process.env[`DODO_${key}`]
    if (legacy !== undefined) return legacy || null

    return null
  }

  return {
    mode,
    apiBase: read("API_BASE") ?? (mode === "test" ? "https://test.dodopayments.com" : "https://live.dodopayments.com"),
    apiKey: read("API_KEY"),
    webhookSecret: read("WEBHOOK_SECRET"),
    productIds: {
      explore: null,
      pro: read("PRODUCT_PRO"),
      max: read("PRODUCT_MAX"),
      credits_500: read("PRODUCT_CREDITS_500"),
      credits_2000: read("PRODUCT_CREDITS_2000"),
      credits_6000: read("PRODUCT_CREDITS_6000"),
    },
  }
}

type DodoEntity = Record<string, unknown>

function planFeatures(key: string): string[] {
  const plan = SHARED_PLANS[key]
  if (!plan) return []
  const l = plan.limits
  return [
    key === "explore" ? `${l.chat.toLocaleString()} AI chats during trial` : `${l.chat.toLocaleString()} AI chats / month`,
    key === "explore" ? `${l.voiceMinutes} min voice during trial` : `${l.voiceMinutes} min voice`,
    key === "explore"
      ? `${plan.includedCredits.toLocaleString()} trial credits`
      : `${plan.includedCredits.toLocaleString()} credits / month`,
    l.reasoning > 0 ? `${l.reasoning} reasoning uses` : "",
    `${l.connectors} app connectors`,
    l.botMessages > 0 ? `${l.botMessages.toLocaleString()} bot messages / month` : "",
  ].filter(Boolean)
}

interface CurrencyDisplay {
  code: string
  symbol: string
  rate: number
  decimals: number
}

const CURRENCIES: Record<string, CurrencyDisplay> = {
  usd: { code: "USD", symbol: "$", rate: 1, decimals: 2 },
  inr: { code: "INR", symbol: "₹", rate: 83, decimals: 0 },
  eur: { code: "EUR", symbol: "€", rate: 0.92, decimals: 2 },
  gbp: { code: "GBP", symbol: "£", rate: 0.79, decimals: 2 },
  aud: { code: "AUD", symbol: "A$", rate: 1.52, decimals: 2 },
  cad: { code: "CAD", symbol: "C$", rate: 1.36, decimals: 2 },
  brl: { code: "BRL", symbol: "R$", rate: 5.05, decimals: 2 },
  jpy: { code: "JPY", symbol: "¥", rate: 149, decimals: 0 },
}

const COUNTRY_CURRENCY: Record<string, string> = {
  IN: "inr",
  US: "usd",
  GB: "gbp",
  CA: "cad",
  AU: "aud",
  BR: "brl",
  JP: "jpy",
  DE: "eur",
  FR: "eur",
  IT: "eur",
  ES: "eur",
  NL: "eur",
  SE: "eur",
  MX: "usd",
  PH: "usd",
  NG: "usd",
  ZA: "usd",
  AE: "usd",
  SG: "usd",
  HK: "usd",
}

function detectCurrency(cfCountry: string | null): CurrencyDisplay {
  const key = cfCountry ? (COUNTRY_CURRENCY[cfCountry.toUpperCase()] ?? "usd") : "usd"
  return CURRENCIES[key] ?? CURRENCIES["usd"]!
}

function estimateLocal(amountCents: number, display: CurrencyDisplay): {
  amount: number
  formatted: string
} {
  if (display.code === "USD") {
    return { amount: amountCents / 100, formatted: `$${(amountCents / 100).toFixed(2)}` }
  }
  const converted = Math.round((amountCents / 100) * display.rate)
  return {
    amount: converted,
    formatted: `${display.symbol}${converted.toLocaleString("en-US", {
      minimumFractionDigits: display.decimals,
      maximumFractionDigits: display.decimals,
    })}`,
  }
}

function dodoAuth(): string {
  const { apiKey, mode } = getDodoConfig()
  if (!apiKey) throw new Error(`DODO_API_KEY is not configured for ${mode} mode`)
  return `Bearer ${apiKey}`
}

async function dodo<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const { apiBase, apiKey, mode } = getDodoConfig()
  const url = `${apiBase.replace(/\/+$/, "")}${path}`

  // Diagnostic log — no secrets
  console.log("[yomi/dodo] mode:", mode, "apiBase:", apiBase, "path:", path, "hasApiKey:", !!apiKey)

  // Reject obviously malformed URLs before fetch
  try {
    new URL(url)
  } catch {
    throw new Error(`Dodo API has an invalid URL: ${url} (mode=${mode})`)
  }

  const httpMethod = method ?? (body === undefined ? "GET" : "POST")

  let res: Response
  try {
    res = await fetch(url, {
      method: httpMethod,
      headers: {
        Authorization: dodoAuth(),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // keepalive:false — prevents Bun's FailedToOpenSocket socket-leak bug
      // (https://github.com/oven-sh/bun/issues/3327)
      keepalive: false,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    // Log the full error chain (message + cause + stack) to diagnose Bun socket issues
    const cause =
      err instanceof Error && "cause" in err
        ? String((err as Error & { cause: unknown }).cause ?? err.stack ?? "")
        : String(err)
    console.error("[yomi/dodo] fetch failed — url:", url, "cause:", cause)
    throw new Error(`Dodo API request failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  const text = await res.text()
  if (!res.ok) throw new Error(`Dodo ${path} -> ${res.status}: ${text}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Dodo ${path} returned non-JSON: ${text.slice(0, 200)}`)
  }
}

function appUrl(path: string): string {
  const base = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3000"
  return `${base.replace(/\/+$/, "")}${path}`
}

function checkoutUrl(data: Record<string, unknown>): string | null {
  return (
    (data["checkout_url"] as string | undefined) ??
    (data["payment_link"] as string | undefined) ??
    (data["url"] as string | undefined) ??
    null
  )
}

async function createDodoCheckout(input: {
  productId: string
  user: { id: string; name?: string | null; email?: string | null }
  metadata: Record<string, string>
}) {
  console.log("[yomi/billing] creating Dodo checkout for productId:", input.productId)
  return dodo<Record<string, unknown>>("/checkouts", {
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    customer: {
      email: input.user.email,
      name: input.user.name,
    },
    metadata: input.metadata,
    return_url: appUrl("/dashboard"),
  })
}

const WEBHOOK_TOLERANCE_SECONDS = 300

export function verifyDodoWebhook(body: string, headers: Headers): boolean {
  const { webhookSecret: secret } = getDodoConfig()
  if (!secret) return false

  const webhookId = headers.get("webhook-id")
  const timestampStr = headers.get("webhook-timestamp")
  const signatureHeader = headers.get("webhook-signature")
  if (!webhookId || !timestampStr || !signatureHeader) return false

  const timestamp = Number(timestampStr)
  if (!Number.isFinite(timestamp)) return false
  const age = Math.abs((Date.now() / 1000) - timestamp)
  if (age > WEBHOOK_TOLERANCE_SECONDS) return false

  const signedPayload = `${webhookId}.${timestampStr}.${body}`
  const normalizedSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret
  const key = secret.startsWith("whsec_")
    ? Buffer.from(normalizedSecret, "base64")
    : Buffer.from(normalizedSecret)
  const expected = createHmac("sha256", key).update(signedPayload).digest("base64")
  const signatures = signatureHeader
    .split(" ")
    .flatMap((part) => part.split(","))
    .map((part) => part.trim())
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part))
    .filter(Boolean)

  return signatures.some((sig) => {
    const actual = Buffer.from(sig)
    const expectedBuffer = Buffer.from(expected)
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer)
  })
}

function eventType(event: Record<string, unknown>): string {
  return String(event["type"] ?? event["event"] ?? event["event_type"] ?? "unknown")
}

function eventData(event: Record<string, unknown>): DodoEntity {
  const data = event["data"]
  if (data && typeof data === "object" && !Array.isArray(data)) return data as DodoEntity
  const payload = event["payload"]
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload as DodoEntity
  return event
}

function metadata(entity: DodoEntity): Record<string, string> {
  const meta = entity["metadata"]
  if (meta && typeof meta === "object" && !Array.isArray(meta)) return meta as Record<string, string>
  return {}
}

function stringField(entity: DodoEntity, keys: string[]): string | null {
  for (const key of keys) {
    const value = entity[key]
    if (typeof value === "string" && value) return value
  }
  return null
}

function numberField(entity: DodoEntity, keys: string[]): number {
  for (const key of keys) {
    const value = entity[key]
    if (typeof value === "number") return value
    if (typeof value === "string" && value && !Number.isNaN(Number(value))) return Number(value)
  }
  return 0
}

function dateField(entity: DodoEntity, keys: string[]): Date | null {
  for (const key of keys) {
    const value = entity[key]
    if (typeof value === "number") return new Date(value > 10_000_000_000 ? value : value * 1000)
    if (typeof value === "string" && value) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) return date
    }
  }
  return null
}

function subscriptionCreditExpiry(periodEnd: Date | null): Date {
  if (periodEnd) return new Date(periodEnd.getTime() + 5 * 24 * 60 * 60 * 1000)
  return new Date(Date.now() + 35 * 24 * 60 * 60 * 1000)
}

function logDodoConfig(): void {
  const env = process.env["DODO_ENV"] ?? ""
  if (env && env !== "test" && env !== "live") {
    console.warn("[yomi/dodo] WARNING: DODO_ENV=" + env + " is invalid; defaulting to test")
  }
  const mode = env === "live" ? "live" : "test"
  const prefix = mode === "live" ? "DODO_LIVE" : "DODO_TEST"
  const apiKey = process.env[`${prefix}_API_KEY`] ?? process.env["DODO_API_KEY"] ?? ""
  const baseUrl = mode === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com"

  if (!apiKey) {
    console.warn("[yomi/dodo] WARNING: " + prefix + "_API_KEY is not set — Dodo Payments will fail at runtime")
  }
  console.log("[yomi/dodo] config:", JSON.stringify({ mode, baseUrl, hasApiKey: !!apiKey }))
}

logDodoConfig()

export const billingRouter = new Hono()

billingRouter.get("/plans", (c) => {
  const display = detectCurrency(c.req.header("CF-IPCountry") ?? null)
  const estimate =
    display.code === "USD"
      ? null
      : `Estimated ${display.code} equivalent. Charged in USD. Your bank may convert the amount automatically.`

  const plans = Object.values(SHARED_PLANS).map((p) => ({
    key: p.key,
    name: p.name,
    amountCents: p.priceCents,
    currency: "USD",
    interval: "month",
    includedCredits: p.includedCredits,
    features: planFeatures(p.key),
    local: p.priceCents > 0 ? estimateLocal(p.priceCents, display) : null,
    notice: estimate,
  }))

  return c.json({ plans, displayCurrency: display.code })
})

billingRouter.post("/create-subscription", authenticate, async (c) => {
  const { plan } = (await c.req.json()) as { plan: string }
  const user = c.get("user")
  const config = SHARED_PLANS[plan]
  if (!config || plan === "explore") return c.json({ error: "Invalid plan" }, 400)

  const productId = getDodoConfig().productIds[plan]
  if (!productId) return c.json({ error: "Dodo product not configured for this tier" }, 500)

  if (user.dodoSubscriptionId && user.plan === plan && user.subscriptionStatus === "active") {
    return c.json({ error: "You already have an active subscription for this plan" }, 409)
  }

  const isUpgrade = user.plan !== "explore" && user.plan !== plan && !!user.dodoSubscriptionId

  try {
    const checkout = await createDodoCheckout({
      productId,
      user,
      metadata: {
        userId: user.id,
        kind: "subscription",
        plan,
        ...(isUpgrade ? { isUpgrade: "true", previousPlan: user.plan } : {}),
      },
    })
    const checkoutId = String(checkout["session_id"] ?? checkout["id"] ?? checkout["checkout_id"] ?? "")
    const url = checkoutUrl(checkout)
    if (!url) throw new Error("Dodo checkout response did not include a checkout URL")

    await createPaymentRecord({
      userId: user.id,
      provider: "dodo",
      kind: "subscription",
      productKey: plan,
      providerOrderId: checkoutId || null,
      amountCents: config.priceCents,
      currency: "USD",
      status: "created",
      metadata: { checkout, isUpgrade, previousPlan: isUpgrade ? user.plan : null },
    })

    return c.json({ id: checkoutId, short_url: url })
  } catch (err) {
    console.error("[yomi/billing] create-subscription failed:", err)
    const msg = err instanceof Error ? err.message : "Unknown error"
    const config = getDodoConfig()
    return c.json({
      error: "Dodo checkout creation failed",
      cause: msg.includes("Dodo ") ? msg : `internal: ${msg}`,
      environment: config.mode,
      targetBase: config.apiBase,
    }, 502)
  }
})

billingRouter.post("/create-credit-pack", authenticate, async (c) => {
  const { pack } = (await c.req.json()) as { pack: string }
  const user = c.get("user")
  const plan = effectivePlanForUser(user)
  if (plan === "explore") return c.json({ error: "Credit packs are only available on Pro and Max plans" }, 403)
  const config = getCreditPack(pack)
  if (!config) return c.json({ error: "Invalid credit pack" }, 400)

  const productId = getDodoConfig().productIds[config.key]
  if (!productId) return c.json({ error: "Dodo product not configured for this credit pack" }, 500)

  try {
    const checkout = await createDodoCheckout({
      productId,
      user,
      metadata: {
        userId: user.id,
        kind: "credit_pack",
        productKey: config.key,
      },
    })
    const url = checkoutUrl(checkout)
    if (!url) throw new Error("Dodo checkout response did not include a checkout URL")

    await createPaymentRecord({
      userId: user.id,
      provider: "dodo",
      kind: "credit_pack",
      productKey: config.key,
      providerOrderId: String(checkout["session_id"] ?? checkout["id"] ?? checkout["checkout_id"] ?? "") || null,
      amountCents: config.priceCents,
      currency: config.currency,
      status: "created",
      metadata: { checkout },
    })

    return c.json({ id: String(checkout["id"] ?? checkout["checkout_id"] ?? ""), short_url: url })
  } catch (err) {
    console.error("[yomi/billing] create-credit-pack failed:", err)
    const msg = err instanceof Error ? err.message : "Unknown error"
    const config = getDodoConfig()
    return c.json({
      error: "Dodo checkout creation failed",
      cause: msg.includes("Dodo ") ? msg : `internal: ${msg}`,
      environment: config.mode,
      targetBase: config.apiBase,
    }, 502)
  }
})

billingRouter.post("/cancel-subscription", authenticate, async (c) => {
  const user = c.get("user")
  if (!user.dodoSubscriptionId) return c.json({ error: "No active subscription" }, 404)

  try {
    await dodo(`/subscriptions/${user.dodoSubscriptionId}/cancel`, undefined, "POST")

    return c.json({ ok: true, message: "Your subscription will cancel at the end of the billing period." })
  } catch (err) {
    console.error("[yomi/billing] cancel-subscription failed:", err)
    const msg = err instanceof Error ? err.message : "Unknown error"
    const config = getDodoConfig()
    return c.json({
      error: "Failed to cancel subscription",
      cause: msg.includes("Dodo ") ? msg : `internal: ${msg}`,
      environment: config.mode,
      targetBase: config.apiBase,
    }, 502)
  }
})

billingRouter.post("/webhook", async (c) => {
  const body = await c.req.text()
  if (!verifyDodoWebhook(body, c.req.raw.headers)) return c.json({ error: "Invalid signature" }, 400)

  let event: Record<string, unknown>
  try {
    event = JSON.parse(body) as Record<string, unknown>
  } catch {
    return c.json({ error: "Invalid JSON" }, 400)
  }

  const type = eventType(event)
  const id = c.req.header("webhook-id") ?? stringField(event, ["id", "event_id"]) ?? `${type}:${payloadHash(body)}`
  const recorded = await recordPaymentEvent({
    provider: "dodo",
    eventId: id,
    eventType: type,
    payloadHash: payloadHash(body),
  })
  if (recorded.duplicate) return c.json({ ok: true, deduplicated: true })

  const entity = eventData(event)
  try {
    await handleDodoEvent(type, entity, id)
  } catch (err) {
    console.error("[yomi/billing] webhook handler error:", err)
    return c.json({ error: "Handler error" }, 500)
  }

  return c.json({ ok: true })
})

billingRouter.get("/subscription", authenticate, async (c) => {
  const sessionUser = c.get("user")
  const [user] = await db
    .select({
      id: authSchema.user.id,
      name: authSchema.user.name,
      email: authSchema.user.email,
      createdAt: authSchema.user.createdAt,
      role: authSchema.user.role,
      plan: authSchema.user.plan,
      subscriptionStatus: authSchema.user.subscriptionStatus,
      trialStartDate: authSchema.user.trialStartDate,
      trialEndDate: authSchema.user.trialEndDate,
      currentPeriodEnd: authSchema.user.currentPeriodEnd,
      dodoSubscriptionId: authSchema.user.dodoSubscriptionId,
      trialInteractionUsed: authSchema.user.trialInteractionUsed,
      trialInteractionLimit: authSchema.user.trialInteractionLimit,
      dailyChatCount: authSchema.user.dailyChatCount,
      dailyVoiceCount: authSchema.user.dailyVoiceCount,
      dailyImageCount: authSchema.user.dailyImageCount,
    })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, sessionUser.id))
    .limit(1)

  if (!user) return c.json({ error: "User not found" }, 404)

  const periodStart = user.currentPeriodEnd
    ? new Date(user.currentPeriodEnd.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(0)

  const usageRows = await db
    .select({ inputTokens: usageEvents.inputTokens, outputTokens: usageEvents.outputTokens })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, user.id), gte(usageEvents.createdAt, periodStart)))

  const tokensUsedThisPeriod = usageRows.reduce(
    (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  )

  const requestPeriodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
  const kindCounts = await db
    .select({ kind: usageEvents.kind, count: sql<number>`count(*)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, user.id),
        gte(usageEvents.createdAt, requestPeriodStart),
        inArray(usageEvents.kind, [
          "request_chat",
          "request_voice",
          "stt",
          "agent_run",
          "screenshot",
          "reasoning",
          "bot_message",
        ]),
      ),
    )
    .groupBy(usageEvents.kind)

  const countMap: Record<string, number> = {}
  for (const row of kindCounts) countMap[row.kind] = Number(row.count)

  const chatUsed = countMap["request_chat"] ?? 0
  const voiceUsed = countMap["request_voice"] ?? 0
  const agentUsed = (countMap["agent_run"] ?? 0) + (countMap["bot_message"] ?? 0)
  const screenshotUsed = countMap["screenshot"] ?? 0
  const reasoningUsed = countMap["reasoning"] ?? 0
  const requestsUsed = chatUsed + voiceUsed
  const requestsLimit = requestLimitForUser(user)
  const requestsRemaining = requestsLimit === null ? null : Math.max(requestsLimit - requestsUsed, 0)
  const resetAt = new Date(Date.UTC(requestPeriodStart.getUTCFullYear(), requestPeriodStart.getUTCMonth() + 1, 1))

  const creditConsumptionRows = await db
    .select({ kind: usageEvents.kind, creditsCharged: sql<number>`sum(${usageEvents.creditsCharged})` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, user.id),
        gte(usageEvents.createdAt, requestPeriodStart),
        sql`${usageEvents.creditsCharged} > 0`,
      ),
    )
    .groupBy(usageEvents.kind)

  const creditConsumption: Record<string, number> = {}
  for (const row of creditConsumptionRows) {
    creditConsumption[row.kind] = Number(row.creditsCharged)
  }

  const connectedProviders = await listConnectedProviders(user.id)
  const connectorLimit = featureLimitForUser(user, "connectors")

  const effectivePlan = effectivePlanForUser(user)
  const planConfig = getPlan(effectivePlan)

  const trialDaysTotal = 30
  let trialDaysUsed = 0
  let trialDaysRemaining = 0
  let trialExpired = false
  let trialStart = user.trialStartDate
  let trialEnd = user.trialEndDate
  if (effectivePlan === "explore") {
    trialStart ??= user.createdAt
    trialEnd ??= new Date(trialStart.getTime() + trialDaysTotal * 24 * 60 * 60 * 1000)
    const usedMs = Date.now() - trialStart.getTime()
    trialDaysUsed = Math.max(0, Math.min(trialDaysTotal, Math.floor((usedMs / (1000 * 60 * 60 * 24)))))
    trialDaysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    trialExpired = Date.now() >= trialEnd.getTime()
  }

  return c.json({
    name: user.name,
    email: user.email,
    role: effectiveRoleForUser(user),
    plan: effectivePlan,
    status: user.subscriptionStatus,
    trialStartDate: trialStart,
    trialEndDate: trialEnd,
    trialDaysUsed,
    trialDaysRemaining,
    trialDaysTotal,
    trialExpired,
    currentPeriodEnd: user.currentPeriodEnd,
    dodoSubscriptionId: user.dodoSubscriptionId,
    requestsUsed,
    requestsLimit,
    requestsRemaining,
    resetAt,
    features: {
      chat: { used: chatUsed, limit: requestsLimit },
      voice: { used: voiceUsed, limit: featureLimitForUser(user, "voiceMinutes") },
      screenshots: { used: screenshotUsed, limit: featureLimitForUser(user, "screenshots") },
      reasoning: { used: reasoningUsed, limit: featureLimitForUser(user, "reasoning") },
      connectors: { used: connectedProviders.length, limit: connectorLimit },
      botMessages: { used: agentUsed, limit: featureLimitForUser(user, "botMessages") },
    },
    planLimits: {
      chat: planConfig.limits.chat,
      voiceMinutes: planConfig.limits.voiceMinutes,
      screenshots: planConfig.limits.screenshots,
      reasoning: planConfig.limits.reasoning,
      connectors: planConfig.limits.connectors,
      botMessages: planConfig.limits.botMessages,
    },
    dailyChatUsed: user.dailyChatCount,
    dailyVoiceUsed: user.dailyVoiceCount,
    dailyImageUsed: user.dailyImageCount,
    tokensUsedThisPeriod,
    credits: await getCreditSummary(user.id),
    creditConsumption,
    creditPacks: effectivePlan !== "explore" ? Object.values(CREDIT_PACKS) : [],
    creditTransactions: await recentCreditTransactions(user.id, 10),
    billingWarning: user.subscriptionStatus === "past_due"
      ? "Your payment is past due. Please update your payment method."
      : null,
  })
})

async function handleDodoEvent(type: string, entity: DodoEntity, eventId: string) {
  const normalized = type.toLowerCase()
  if (normalized.includes("subscription") && normalized.match(/active|renew|paid|success|charge/)) {
    await handleSubscriptionActive(entity, eventId)
    return
  }
  if (normalized.includes("subscription") && normalized.match(/cancel|expire|complete/)) {
    await handleSubscriptionEnd(entity)
    return
  }
  if (normalized.includes("subscription") && normalized.match(/fail|past_due|halt/)) {
    await handlePaymentFailed(entity)
    return
  }
  if (normalized.includes("payment") && normalized.match(/success|succeed|paid|captured/)) {
    await handlePaymentSucceeded(entity, eventId)
  }
}

async function findUserBySubscription(subId: string): Promise<string | null> {
  const [user] = await db
    .select({ id: authSchema.user.id })
    .from(authSchema.user)
    .where(eq(authSchema.user.dodoSubscriptionId, subId))
    .limit(1)
  return user?.id ?? null
}

async function handleSubscriptionActive(entity: DodoEntity, eventId: string) {
  const meta = metadata(entity)
  const subId = stringField(entity, ["subscription_id", "id"])
  let userId = meta.userId
  const plan = meta.plan

  if (!userId && subId) userId = (await findUserBySubscription(subId)) ?? undefined
  if (!userId || !plan) return

  const config = SHARED_PLANS[plan]
  if (!config) return

  const customerId = stringField(entity, ["customer_id", "customerId"])
  const periodEnd = dateField(entity, ["current_period_end", "currentPeriodEnd", "next_billing_date"])

  // Detect plan change — cancel old Dodo subscription if user switched plans
  const [existing] = await db
    .select({ plan: authSchema.user.plan, dodoSubscriptionId: authSchema.user.dodoSubscriptionId })
    .from(authSchema.user)
    .where(eq(authSchema.user.id, userId))
    .limit(1)

  const isRenewal = existing?.plan === plan
  const isUpgrade = existing?.plan !== "explore" && existing?.plan !== plan && existing?.plan !== undefined

  if (isUpgrade && existing?.dodoSubscriptionId && existing.dodoSubscriptionId !== subId) {
    try {
      console.warn(`[yomi/billing] cancelling old subscription ${existing.dodoSubscriptionId} for upgrade to ${plan}`)
      await dodo(`/subscriptions/${existing.dodoSubscriptionId}`, { cancel_at_next_billing_date: true }, "PATCH")
    } catch (err) {
      console.warn("[yomi/billing] failed to cancel old subscription on upgrade:", err)
    }
  }

  // Create or update payment record for subscription activation/renewal
  const paymentId = await upsertPaymentRecord({
    userId,
    provider: "dodo",
    kind: "subscription",
    productKey: plan,
    providerCustomerId: customerId,
    providerOrderId: subId,
    providerSubscriptionId: subId,
    amountCents: config.priceCents,
    currency: "USD",
    status: "paid",
    metadata: {
      providerEvent: { type: "subscription_active", eventId },
      plan,
      isRenewal,
      previousPlan: existing?.plan ?? null,
    },
  })

  await db
    .update(authSchema.user)
    .set({
      plan,
      subscriptionStatus: "active",
      dodoCustomerId: customerId,
      dodoSubscriptionId: subId,
      currentPeriodEnd: periodEnd,
    })
    .where(eq(authSchema.user.id, userId))

  if (config.includedCredits <= 0) return

  try {
    await grantCredits({
      userId,
      amount: config.includedCredits,
      source: "subscription_cycle",
      sourceId: `${subId ?? "subscription"}:${periodEnd?.toISOString() ?? eventId}`,
      idempotencyKey: `dodo:${eventId}:subscription_credits`,
      paymentId,
      expiresAt: subscriptionCreditExpiry(periodEnd),
      reason: `${config.name} monthly credits`,
      metadata: { provider: "dodo", subscriptionId: subId, plan, isRenewal },
    })
  } catch (err) {
    console.error("[yomi/billing] grantCredits failed for subscription", eventId, err)
  }
}

async function handleSubscriptionEnd(entity: DodoEntity) {
  const meta = metadata(entity)
  const subId = stringField(entity, ["subscription_id", "id"])
  let userId = meta.userId

  if (!userId && subId) userId = (await findUserBySubscription(subId)) ?? undefined
  if (!userId) return

  // Find and update matching payment record
  if (subId) {
    const [rec] = await db
      .select({ id: paymentRecords.id })
      .from(paymentRecords)
      .where(
        and(
          eq(paymentRecords.provider, "dodo"),
          eq(paymentRecords.providerOrderId, subId),
        ),
      )
      .limit(1)

    if (rec) {
      await db
        .update(paymentRecords)
        .set({ status: "cancelled", updatedAt: new Date(), metadata: { cancelledAt: new Date().toISOString() } })
        .where(eq(paymentRecords.id, rec.id))
    }
  }

  await db
    .update(authSchema.user)
    .set({
      plan: "explore",
      subscriptionStatus: "inactive",
      dodoSubscriptionId: null,
      currentPeriodEnd: null,
    })
    .where(eq(authSchema.user.id, userId))
}

async function handlePaymentFailed(entity: DodoEntity) {
  const meta = metadata(entity)
  const subId = stringField(entity, ["subscription_id", "id"])
  let userId = meta.userId

  if (!userId && subId) userId = (await findUserBySubscription(subId)) ?? undefined
  if (!userId) return

  await db
    .update(authSchema.user)
    .set({ subscriptionStatus: "past_due" })
    .where(eq(authSchema.user.id, userId))
}

async function handlePaymentSucceeded(entity: DodoEntity, eventId: string) {
  const meta = metadata(entity)
  if (meta.kind !== "credit_pack" || !meta.userId || !meta.productKey) return

  const pack = getCreditPack(meta.productKey)
  if (!pack) return

  const paymentId = await upsertPaymentRecord({
    userId: meta.userId,
    provider: "dodo",
    kind: "credit_pack",
    productKey: pack.key,
    providerCustomerId: stringField(entity, ["customer_id", "customerId"]),
    providerOrderId: stringField(entity, ["checkout_id", "payment_link_id", "order_id"]),
    providerPaymentId: stringField(entity, ["payment_id", "id"]),
    amountCents: numberField(entity, ["amount", "total_amount"]) || pack.priceCents,
    currency: stringField(entity, ["currency"]) ?? pack.currency,
    status: "paid",
    metadata: { providerEvent: { eventId, type: "payment_succeeded" } },
  })

  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
  try {
    await grantCredits({
      userId: meta.userId,
      amount: pack.credits,
      source: "credit_pack",
      sourceId: stringField(entity, ["payment_id", "id", "checkout_id"]) ?? eventId,
      idempotencyKey: `dodo:${eventId}:credit_pack:${pack.key}`,
      paymentId,
      expiresAt,
      reason: `${pack.name} purchase`,
      metadata: {
        provider: "dodo",
        productKey: pack.key,
      },
    })
  } catch (err) {
    console.error("[yomi/billing] grantCredits failed for payment", eventId, err)
  }
}
