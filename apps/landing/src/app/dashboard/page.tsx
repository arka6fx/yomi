"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  LogOut,
  Check,
  Crown,
  Loader2,
  Download,
  Shield,
  Sparkles,
  Cuboid,
  Trash2,
  AlertTriangle,
  WalletCards,
  ReceiptText,
  Plug,
  MessageSquare,
  Mic,
  ScanLine,
  Bot,
  Plus,
  ExternalLink,
  Zap,
  Brain,
  Clock,
  Activity,
  type LucideIcon,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { TelegramIcon } from "@/components/TelegramIcon"
import { MemoryManager } from "@/components/dashboard/MemoryManager"
import { SchedulesManager } from "@/components/dashboard/SchedulesManager"
import { ConversationManager } from "@/components/dashboard/ConversationManager"
import { StatusManager } from "@/components/dashboard/StatusManager"
import { ConnectorMarketplace, buildCatalog, DARK_THEME } from "@yomi/ui-connectors"

type FeatureUsage = { used: number; limit: number | null }

type IntegrationHealth = {
  provider: string
  displayName: string
  connected: boolean
  healthy: boolean
  status: "connected" | "needs_reconnect"
  message: string | null
  updatedAt: string
}

type Sub = {
  role: string
  plan: string
  status: string
  trialStartDate: string | null
  trialEndDate: string | null
  trialDaysUsed: number
  trialDaysRemaining: number
  trialDaysTotal: number
  trialExpired: boolean
  currentPeriodEnd: string | null
  dodoSubscriptionId: string | null
  requestsUsed: number
  requestsLimit: number | null
  requestsRemaining: number | null
  resetAt: string | null
  billingWarning: string | null
  features: {
    chat: FeatureUsage
    voice: FeatureUsage
    analyze: FeatureUsage
    connectors: FeatureUsage
    botMessages: FeatureUsage
  }
  planLimits?: {
    chat: number
    voiceMinutes: number
    analyze: number
    connectors: number | null
    botMessages: number
  }
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
  credits?: {
    balance: number
    lifetimeGranted: number
    lifetimeConsumed: number
    lifetimeRefunded: number
    expiringSoon: number
    expiringSoonAt: string | null
  }
  creditConsumption?: Record<string, number>
  creditsUsed?: number
  totalCredits?: number
  creditPacks?: Array<{
    key: string
    name: string
    credits: number
    priceCents: number
    priceDisplay: string
    currency: string
  }>
  creditTransactions?: Array<{
    id: string
    type: string
    amount: number
    balanceAfter: number
    reason: string | null
    usageEventId: string | null
    usageKind: string | null
    usageCreditsCharged: number | null
    usageCreatedAt: string | null
    createdAt: string
  }>
}

const CREDIT_USAGE_LABELS: Record<string, string> = {
  request_chat: "AI chat",
  request_voice: "Voice",
  analyze: "Image/screen analyze",
  bot_message: "Bot message",
}

function creditActivityTitle(tx: NonNullable<Sub["creditTransactions"]>[number]) {
  if (tx.type === "grant") return "Credits added"
  if (tx.type === "consume") return tx.usageKind ? `Used on ${CREDIT_USAGE_LABELS[tx.usageKind] ?? tx.usageKind}` : "Credits used"
  return tx.type
}

function creditActivityDetail(tx: NonNullable<Sub["creditTransactions"]>[number]) {
  const happenedAt = new Date(tx.usageCreatedAt ?? tx.createdAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const parts = [happenedAt]
  if (tx.reason) parts.push(tx.reason)
  if (tx.usageEventId) parts.push(`request ${tx.usageEventId.slice(0, 8)}`)
  return parts.join(" · ")
}

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    price: "$0",
    priceSub: "/ month",
    badge: "30-day trial",
    desc: "Try screen-aware AI, voice, and memory for 30 days. No card needed.",
    icon: Sparkles,
    features: [
      "100 credits (30-day trial)",
      "Screen-aware AI & voice",
      "Image/screen analyze",
      "Local memory notepad",
      "Unlimited app connectors",
      "Telegram bot",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$14.99",
    priceSub: "/ month",
    badge: "Most Popular",
    desc: "Screen, voice, memory, and images for everyday work.",
    icon: Crown,
    features: [
      "2,500 credits / month",
      "Buy extra credit packs anytime",
      "Screen, voice, memory & images",
      "Unlimited app connectors",
      "Telegram bot",
    ],
  },
  {
    key: "max",
    name: "Max",
    price: "$39.99",
    priceSub: "/ month",
    badge: "Power users",
    desc: "High-volume credits for power users.",
    icon: Cuboid,
    features: [
      "Everything in Pro",
      "10,000 credits / month",
      "Buy extra credit packs anytime",
      "Unlimited app connectors",
      "Experimental features first",
    ],
  },
]

type PlatformLink = { platform: string; connectedAt: string }

// /api/* is proxied to the backend by the cloudflare worker
const PLATFORM_META: Record<string, { name: string; color: string; inviteUrl: string }> = {
  telegram: {
    name: "Telegram",
    color: "bg-sky-500/10 text-sky-400",
    inviteUrl: "",
  },
}

function DashboardContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [sub, setSub] = useState<Sub | null>(null)
  const [subPending, setSubPending] = useState(true)
  const [subLoadError, setSubLoadError] = useState("")
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const [billingError, setBillingError] = useState("")
  const [creditLoading, setCreditLoading] = useState<string | null>(null)
  const [desiredPlan, setDesiredPlan] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [activeTab, setActiveTab] = useState<"account" | "integrations" | "memory" | "schedules" | "conversation" | "status">("account")
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealth[]>([])
  const [integrationLoadingId, setIntegrationLoadingId] = useState<string | null>(null)
  const [integrationConnectError, setIntegrationConnectError] = useState("")
  const [showWelcome, setShowWelcome] = useState(false)

  const [apiKeyModal, setApiKeyModal] = useState<{
    id: string
    fields: Array<{ name: string; label: string; placeholder?: string; secret: boolean }>
    docsUrl?: string
  } | null>(null)
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({})
  const [apiKeySubmitting, setApiKeySubmitting] = useState(false)
  const [apiKeyError, setApiKeyError] = useState("")

  const [dsnModal, setDsnModal] = useState<{
    id: string
    field: { label: string; placeholder: string }
  } | null>(null)
  const [dsnValue, setDsnValue] = useState("")
  const [dsnSubmitting, setDsnSubmitting] = useState(false)
  const [dsnError, setDsnError] = useState("")

  const [platformLinks, setPlatformLinks] = useState<PlatformLink[]>([])
  const [platformsLoading, setPlatformsLoading] = useState(true)
  const [unlinking, setUnlinking] = useState<string | null>(null)

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  useEffect(() => {
    if (!session) return
    fetch("/api/billing/subscription", {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error(`billing ${r.status}`)
        return r.json()
      })
      .then((d: Sub) => {
        setSub(d)
        setSubLoadError("")
      })
      .catch(() => {
        setSub(null)
        setSubLoadError("Couldn't load billing and usage data. Please retry in a moment.")
      })
      .finally(() => setSubPending(false))
  }, [session])

  // Poll billing data every 30s to keep usage meters current
  useEffect(() => {
    if (!session) return
    const interval = setInterval(async () => {
      try {
        const r = await fetch("/api/billing/subscription", {
          headers: { Authorization: `Bearer ${session.session.token}` },
        })
        if (r.ok) {
          const d: Sub = await r.json()
          setSub(d)
        }
      } catch { /* ignore polling errors */ }
    }, 30_000)
    return () => clearInterval(interval)
  }, [session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDesiredPlan(params.get("plan"))
    if (params.has("welcome")) setShowWelcome(true)
    if (params.has("integration_success") || params.has("integration_error")) {
      setActiveTab("integrations")
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/integrations/status?health=1`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => r.ok ? r.json() : { connected: [], integrations: [] })
      .then((d: { connected: string[]; integrations?: IntegrationHealth[] }) => {
        setConnectedProviders(d.connected)
        setIntegrationHealth(Array.isArray(d.integrations) ? d.integrations : [])
      })
      .catch(() => {}) // ignore — integrations tab is best-effort
  }, [session])

  useEffect(() => {
    if (!session) return
    const token = session.session.token
    let cancelled = false
    const load = () => {
      fetch("/api/gateway/connections", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: PlatformLink[]) => { if (!cancelled) setPlatformLinks(Array.isArray(d) ? d : []) })
        .catch(() => { if (!cancelled) setPlatformLinks([]) })
        .finally(() => { if (!cancelled) setPlatformsLoading(false) })
    }
    load()
    // Re-check when the user returns to this tab/window — linking happens on Telegram
    // (often on another device), so the connection appears without a manual reload.
    const onFocus = () => load()
    const onVisible = () => { if (document.visibilityState === "visible") load() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [session])

  useEffect(() => {
    if (!desiredPlan || !session || subPending || !sub) return
    if (desiredPlan !== sub.plan && desiredPlan !== "explore") handleUpgrade(desiredPlan)
  }, [desiredPlan, session, subPending, sub])

  async function handleUpgrade(planKey: string) {
    if (planKey === "explore") return
    setBillingError("")
    setBillingLoading(planKey)
    try {
      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Billing failed")
      window.location.href = data.short_url
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Failed to start billing")
      setBillingLoading(null)
    }
  }

  async function handleCancelSubscription() {
    if (!sub?.dodoSubscriptionId) return
    setCancelling(true)
    try {
      const res = await fetch("/api/billing/cancel-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Cancellation failed")
      // Refresh subscription state
      const subRes = await fetch("/api/billing/subscription", {
        headers: { Authorization: `Bearer ${session!.session.token}` },
      })
      if (subRes.ok) setSub(await subRes.json())
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Failed to cancel")
    } finally {
      setCancelling(false)
    }
  }

  async function handleBuyCredits(pack: string) {
    setBillingError("")
    setCreditLoading(pack)
    try {
      const res = await fetch("/api/billing/create-credit-pack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session!.session.token}`,
        },
        body: JSON.stringify({ pack }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Credit purchase failed")
      window.location.href = data.short_url
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : "Failed to start credit purchase")
      setCreditLoading(null)
    }
  }

  async function handleConnectIntegration(id: string) {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    const info = buildCatalog([]).find((c) => c.id === id)
    setIntegrationConnectError("")

    if (info?.authKind === "api_key" || info?.authKind === "connection_string") {
      setIntegrationLoadingId(id)
      try {
        const res = await fetch(`${apiBase}/api/integrations/connect/${id}`, {
          headers: { Authorization: `Bearer ${session!.session.token}` },
        })
        const data = await res.json() as { kind: string; fields?: Array<{ name: string; label: string; placeholder?: string; secret: boolean }>; field?: { label: string; placeholder: string }; docsUrl?: string }
        if (data.kind === "api_key" && data.fields) {
          setApiKeyModal({ id, fields: data.fields, docsUrl: data.docsUrl })
          setApiKeyValues({})
          setApiKeyError("")
        } else if (data.kind === "connection_string" && data.field) {
          setDsnModal({ id, field: data.field })
          setDsnValue("")
          setDsnError("")
        }
      } catch { /* best-effort */ } finally {
        setIntegrationLoadingId(null)
      }
      return
    }

    // OAuth2: fetch with Bearer token to get the redirect URL, then navigate
    try {
      setIntegrationLoadingId(id)
      const res = await fetch(`${apiBase}/api/integrations/connect/${id}`, {
        headers: { Authorization: `Bearer ${session!.session.token}`, Accept: "application/json" },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { redirectUrl?: string }
      if (!data.redirectUrl) throw new Error("Missing OAuth redirect URL")
      window.location.href = data.redirectUrl
    } catch (err) {
      setIntegrationConnectError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setIntegrationLoadingId(null)
    }
  }

  async function handleSubmitApiKey() {
    if (!apiKeyModal || !session) return
    setApiKeySubmitting(true)
    setApiKeyError("")
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${apiBase}/api/integrations/connect/api-key/${apiKeyModal.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ fields: apiKeyValues }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to connect")
      setConnectedProviders((prev) => [...prev, apiKeyModal.id])
      setApiKeyModal(null)
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setApiKeySubmitting(false)
    }
  }

  async function handleSubmitDsn() {
    if (!dsnModal || !session) return
    setDsnSubmitting(true)
    setDsnError("")
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${apiBase}/api/integrations/connect/dsn/${dsnModal.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ dsn: dsnValue }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to connect")
      setConnectedProviders((prev) => [...prev, dsnModal.id])
      setDsnModal(null)
    } catch (err) {
      setDsnError(err instanceof Error ? err.message : "Connection failed")
    } finally {
      setDsnSubmitting(false)
    }
  }

  async function handleDisconnectIntegration(id: string) {
    if (!session) return
    setIntegrationLoadingId(id)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      await fetch(`${apiBase}/api/integrations/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.session.token}` },
      })
      setConnectedProviders((prev) => prev.filter((p) => p !== id))
    } catch { /* best-effort */ } finally {
      setIntegrationLoadingId(null)
    }
  }

  async function handleUnlink(platform: string) {
    setUnlinking(platform)
    try {
      const res = await fetch(`/api/gateway/connections/${platform}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session!.session.token}` },
      })
      if (res.ok) {
        setPlatformLinks((prev) => prev.filter((p) => p.platform !== platform))
      }
    } catch {
      // ignore
    } finally {
      setUnlinking(null)
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/sign-out-all", { method: "POST" })
    } catch {
      // best-effort
    }
    await authClient.signOut()
    router.push("/")
  }

  if (isPending || !session) return null

  const isOwner = sub?.role === "owner"
  const currentPlanKey = sub?.plan ?? "explore"
  const currentPlanIdx = PLANS.findIndex((p) => p.key === currentPlanKey)

  return (
    <div className="site-texture-bg min-h-dvh text-foreground">

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link href="/" className="font-display text-xl font-bold text-foreground select-none shrink-0">
            Yomi
          </Link>
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {session.user.email}
            </span>
            {isOwner && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 font-medium">
                <Shield size={11} />
                Owner
              </span>
            )}
            <button
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <LogOut size={14} />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8 sm:space-y-10 relative z-10">
        {/* Welcome */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="text-3xl font-light text-foreground" style={{ letterSpacing: "-0.03em" }}>
            Hey, {session.user.name?.split(" ")[0] ?? "there"}.
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">Your Yomi account overview.</p>
        </motion.div>

        {/* Tab switcher — horizontally scrollable on small screens */}
        <div className="-mx-4 sm:mx-0 overflow-x-auto no-scrollbar border-b border-border">
          <div className="flex gap-1 px-4 sm:px-0 min-w-max">
            {(["account", "integrations", "memory", "schedules", "conversation", "status"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex items-center gap-1.5 px-3 sm:px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap",
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "integrations" && <Plug size={13} />}
                {tab === "memory" && <Brain size={13} />}
                {tab === "schedules" && <Clock size={13} />}
                {tab === "conversation" && <MessageSquare size={13} />}
                {tab === "status" && <Activity size={13} />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === "integrations" && connectedProviders.length > 0 && (
                  <span className="ml-1 bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full leading-none">
                    {connectedProviders.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Integrations tab */}
        {activeTab === "integrations" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-card">
              {/* Header: Telegram brand identity + state */}
              <div className="flex items-start justify-between gap-3 sm:gap-4 border-b border-border/60 p-5 sm:p-6">
                <div className="flex items-start gap-3.5">
                  <TelegramIcon size={44} className="shrink-0 drop-shadow-[0_4px_14px_rgba(34,158,217,0.35)]" />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
                      {!platformsLoading && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                            platformLinks.length > 0
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              platformLinks.length > 0 ? "bg-emerald-400" : "bg-muted-foreground/50",
                            )}
                          />
                          {platformLinks.length > 0 ? "Active" : "Not connected"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">
                      Chat with Yomi from any device, right inside Telegram.
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {[
                        { label: "Text", cost: "1 credit" },
                        { label: "Voice", cost: "+2/min" },
                        { label: "Image", cost: "+1" },
                      ].map((c) => (
                        <span
                          key={c.label}
                          className="inline-flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5"
                        >
                          <span className="text-muted-foreground/70">{c.label}</span>
                          <span className="font-medium text-foreground/80 tabular-nums">{c.cost}</span>
                        </span>
                      ))}
                      <span className="text-muted-foreground/60">· charged only when used</span>
                    </div>
                  </div>
                </div>
                {platformLinks.length > 0 && (
                  <Link
                    href="/link"
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                  >
                    <Plus size={12} />
                    Link new
                  </Link>
                )}
              </div>

              <div className="p-5 pt-4 sm:p-6 sm:pt-5">
              {platformsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  Loading…
                </div>
              ) : platformLinks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-7 text-center">
                  <TelegramIcon size={48} className="mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">Connect Telegram to chat anywhere</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                    Link your account with a secure one-time code. Takes a few seconds.
                  </p>
                  <Link
                    href="/link"
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <TelegramIcon size={15} />
                    Connect Telegram
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  {platformLinks.map((link) => {
                    const meta = PLATFORM_META[link.platform] ?? {
                      name: link.platform,
                      color: "bg-muted text-muted-foreground",
                      inviteUrl: "",
                    }
                    return (
                      <div
                        key={link.platform}
                        className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80"
                      >
                        <div className="flex items-center gap-3">
                          <TelegramIcon size={32} className="shrink-0" />
                          <div className="leading-tight">
                            <p className="text-sm font-medium capitalize text-foreground">{meta.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Linked{" "}
                              {new Date(link.connectedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Link
                            href="/link"
                            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Manage
                          </Link>
                          <button
                            onClick={() => handleUnlink(link.platform)}
                            disabled={unlinking === link.platform}
                            className="flex items-center gap-1 text-xs text-destructive/70 transition-colors hover:text-destructive disabled:opacity-50"
                          >
                            {unlinking === link.platform ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Trash2 size={12} />
                            )}
                            Unlink
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              </div>
            </div>

            {new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").has("integration_success") && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                Integration connected successfully.
              </div>
            )}
            {new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").has("integration_error") && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Integration failed: {new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("integration_error")}
              </div>
            )}
            {integrationConnectError && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                Integration failed: {integrationConnectError}
              </div>
            )}
            {integrationHealth.some((item) => !item.healthy) && (
              <div className="mb-4 rounded-2xl border border-yellow-500/25 bg-yellow-500/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
                  <div className="space-y-3 flex-1">
                    <div>
                      <p className="text-sm font-medium text-yellow-300">Some integrations need reconnecting</p>
                      <p className="text-xs text-yellow-200/75 mt-1">
                        Yomi will avoid stale tokens once you reconnect these providers.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {integrationHealth.filter((item) => !item.healthy).map((item) => (
                        <div key={item.provider} className="flex items-center justify-between gap-3 rounded-xl bg-background/50 border border-yellow-500/15 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm text-foreground truncate">{item.displayName}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.message ?? "Authentication failed"}</p>
                          </div>
                          <button
                            onClick={() => handleConnectIntegration(item.provider)}
                            className="shrink-0 rounded-lg bg-yellow-400 text-black px-3 py-1.5 text-xs font-medium hover:bg-yellow-300 transition-colors"
                          >
                            Reconnect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <ConnectorMarketplace
              connectors={buildCatalog(connectedProviders)}
              theme={DARK_THEME}
              onConnect={handleConnectIntegration}
              onDisconnect={handleDisconnectIntegration}
              loadingId={integrationLoadingId}
            />
          </motion.div>
        )}

        {/* Memory tab */}
        {activeTab === "memory" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <MemoryManager token={session.session.token} />
          </motion.div>
        )}

        {/* Schedules tab */}
        {activeTab === "schedules" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <SchedulesManager token={session.session.token} />
          </motion.div>
        )}

        {/* Conversation tab */}
        {activeTab === "conversation" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ConversationManager token={session.session.token} />
          </motion.div>
        )}

        {/* Status tab */}
        {activeTab === "status" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <StatusManager token={session.session.token} />
          </motion.div>
        )}

        {/* Account tab content — only shown when account tab active */}
        {activeTab === "account" && <>

        {/* Welcome banner — shown once after signup */}
        {showWelcome && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex items-start justify-between gap-4"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Welcome to Yomi!</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Download the desktop app to get started. It lives in your system tray and
                responds to{" "}
                <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                  Ctrl+Space
                </kbd>.
              </p>
              <Link
                href="/#download"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <Download size={12} />
                Download for Windows
              </Link>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0 text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </motion.div>
        )}

        {/* Billing warnings */}
        {sub?.billingWarning && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-start gap-3"
          >
            <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-yellow-300 font-medium">Payment past due</p>
              <p className="text-xs text-yellow-400/80">{sub.billingWarning}</p>
            </div>
          </motion.div>
        )}

        {subLoadError && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3"
          >
            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-destructive font-medium">Usage data unavailable</p>
              <p className="text-xs text-destructive/80">{subLoadError}</p>
            </div>
          </motion.div>
        )}

        {/* Plan card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
        >
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                Current plan
              </p>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-2xl font-light text-foreground capitalize"
                  style={{ letterSpacing: "-0.02em" }}
                >
                  {subPending
                    ? "…"
                    : sub
                      ? (PLANS.find((p) => p.key === currentPlanKey)?.name ?? currentPlanKey)
                      : "Unavailable"}
                </span>
                {!subPending && sub && (
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full font-medium",
                      isOwner
                        ? "bg-sky-500/10 text-sky-300"
                        : sub.status === "active"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : sub.status === "past_due"
                            ? "bg-red-500/10 text-red-400"
                            : "bg-sky-500/10 text-sky-300",
                    )}
                  >
                    {isOwner ? "owner" : sub.status === "past_due" ? "past due" : sub.plan === "explore" ? "trial" : sub.status}
                  </span>
                )}
              </div>
              {/* Renewal date */}
              {sub?.currentPeriodEnd && (
                <p className="text-xs text-muted-foreground mt-1">
                  Renews{" "}
                  {new Date(sub.currentPeriodEnd).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
              {sub && sub.plan !== "explore" && (
                <p className="text-[11px] text-muted-foreground/60 mt-1">
                  Charged in USD. Your bank may convert the amount automatically.
                </p>
              )}
            </div>
            {sub?.dodoSubscriptionId && sub.plan !== "explore" && (
              <button
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
              >
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Cancel subscription
              </button>
            )}
          </div>
        </motion.div>

        {/* Usage section — single credit meter */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
        >
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex items-start justify-between gap-6 mb-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                  Credits meter
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light text-foreground tabular-nums">
                    {sub?.creditsUsed ?? 0}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    of {sub?.totalCredits ?? sub?.credits?.balance ?? 0} credits used
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {sub?.credits?.balance ?? 0} credits available
                  {sub?.plan === "explore" ? ". Extra credit packs unlock on Pro and Max." : ". Add credits any time on Pro or Max."}
                </p>
              </div>
            </div>

            {sub && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, ((sub.creditsUsed ?? 0) / Math.max(sub.totalCredits ?? 1, 1)) * 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{sub.creditsUsed ?? 0} used</span>
                    <span>{sub.credits?.balance ?? 0} remaining</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    { label: "AI chat", cost: "1 credit", Icon: MessageSquare as LucideIcon },
                    { label: "Telegram text", cost: "1 base credit", Icon: Bot as LucideIcon },
                    { label: "Image/screen", cost: "+1 credit", Icon: ScanLine as LucideIcon },
                    { label: "Voice input/output", cost: "+2 credits/min", Icon: Mic as LucideIcon },
                  ]).map(({ label, cost, Icon }) => (
                    <div key={label} className="rounded-xl border border-border bg-background/50 p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                        <Icon size={13} />
                        {label}
                      </div>
                      <p className="text-sm font-medium text-foreground">{cost}</p>
                    </div>
                  ))}
                </div>

                {sub.creditConsumption && Object.keys(sub.creditConsumption).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {([
                      { key: "request_chat", label: "AI chat", Icon: MessageSquare as LucideIcon },
                      { key: "request_voice", label: "Voice", Icon: Mic as LucideIcon },
                      { key: "analyze", label: "Image/screen", Icon: ScanLine as LucideIcon },
                      { key: "bot_message", label: "Telegram text", Icon: Bot as LucideIcon },
                    ]).map(({ key, label, Icon }) => {
                      const amount = sub.creditConsumption?.[key] ?? 0
                      if (amount === 0) return null
                      return (
                        <div key={key} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
                          <Icon size={13} className="text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">{label}</span>
                          <span className="text-sm font-medium text-foreground tabular-nums ml-auto">{amount}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Explore users out of credits (trial expired OR balance spent) must subscribe — no free top-ups. */}
            {sub?.plan === "explore" && (sub?.trialExpired || sub?.credits?.balance === 0) && (
              <div className="mt-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive font-medium mb-1">
                  {sub.trialExpired ? "Free trial has ended" : "You're out of trial credits"}
                </p>
                <p className="text-xs text-destructive/80 mb-3">
                  {sub.trialExpired
                    ? "Your 30-day Explore trial has ended. Subscribe to Pro or Max to continue using Yomi."
                    : "You've used all your trial credits. Subscribe to Pro or Max to keep using Yomi. You can buy extra credit packs once subscribed."}
                </p>
                <button
                  onClick={() => handleUpgrade("pro")}
                  disabled={billingLoading !== null}
                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Crown size={12} />
                  Subscribe to Pro · $14.99/mo
                </button>
              </div>
            )}

            {/* Subscribed users out of credits buy a pack (packs section is just below). */}
            {sub?.plan !== "explore" && sub?.credits?.balance === 0 && (
              <div className="mt-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                <p className="text-sm text-yellow-400 font-medium mb-1">No credits remaining</p>
                <p className="text-xs text-yellow-400/80 mb-3">
                  You've used all your credits for this period. Buy a credit pack below to keep going{sub?.resetAt ? `, or they reset on ${new Date(sub.resetAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}` : ""}.
                </p>
                <button
                  onClick={() => sub?.creditPacks?.[0] && handleBuyCredits(sub.creditPacks[0].key)}
                  disabled={creditLoading !== null || !sub?.creditPacks?.length}
                  className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  <Zap size={12} />
                  Buy {sub?.creditPacks?.[0]?.name ?? "credits"}
                </button>
              </div>
            )}

            {sub?.features?.connectors && (
              <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 text-sm">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Plug size={15} />
                  App connectors
                </span>
                <span className="text-foreground tabular-nums">
                  {sub.features.connectors.limit === null
                    ? `${sub.features.connectors.used} connected`
                    : `${sub.features.connectors.used} / ${sub.features.connectors.limit}`}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {/* Credit packs and activity */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.14 }}
        >
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-6 mb-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                  Credit packs and activity
                </p>
                <div className="flex items-center gap-3">
                  <WalletCards size={24} className="text-primary" />
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-light text-foreground tabular-nums">
                        {sub?.credits?.balance ?? 0}
                      </span>
                      <span className="text-sm text-muted-foreground">available</span>
                    </div>
                    {sub?.credits?.expiringSoon ? (
                      <p className="text-xs text-yellow-400 mt-1">
                        {sub.credits.expiringSoon} expire soon
                        {sub.credits.expiringSoonAt
                          ? ` on ${new Date(sub.credits.expiringSoonAt).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        Purchase packs on Pro or Max. Usage is tracked in the meter above.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {sub?.plan !== "explore" ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full sm:w-auto">
                  {(sub?.creditPacks ?? []).map((pack) => (
                    <button
                      key={pack.key}
                      onClick={() => handleBuyCredits(pack.key)}
                      disabled={creditLoading !== null}
                      className="rounded-xl border border-border bg-background px-3 py-2 text-left hover:border-primary/60 transition-colors disabled:opacity-50"
                    >
                      <span className="block text-sm font-medium text-foreground">{pack.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {creditLoading === pack.key ? "Starting..." : pack.priceDisplay}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="w-full sm:w-auto">
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-2">Add credits on Pro or Max</p>
                    <a
                      href="/dashboard?plan=pro"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Crown size={11} />
                      Upgrade to Pro
                    </a>
                  </div>
                </div>
              )}
            </div>

            {(sub?.creditTransactions?.length ?? 0) > 0 && (
              <div className="border-t border-border pt-4">
                <div className="flex items-center gap-2 mb-3">
                  <ReceiptText size={14} className="text-muted-foreground" />
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Recent activity
                  </p>
                </div>
                <div className="space-y-2">
                  {sub!.creditTransactions!.slice(0, 10).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between gap-4 text-sm">
                      <div className="min-w-0">
                        <p className="text-foreground capitalize">{creditActivityTitle(tx)}</p>
                        <p className="text-xs text-muted-foreground">
                          {creditActivityDetail(tx)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={cn("tabular-nums", tx.amount >= 0 ? "text-emerald-400" : "text-muted-foreground")}>
                          {tx.amount >= 0 ? "+" : ""}
                          {tx.amount}
                        </p>
                        <p className="text-xs text-muted-foreground">{tx.balanceAfter} left</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Plans — hidden for owner */}
        {!isOwner && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
          >
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-4">
              Plans
            </p>
            {billingError && <p className="text-xs text-destructive mb-4">{billingError}</p>}
            <div className="grid sm:grid-cols-3 gap-3">
              {PLANS.map((plan, i) => {
                const isCurrent = plan.key === currentPlanKey
                const isUpgrade = i > currentPlanIdx
                const Icon = plan.icon

                return (
                  <div
                    key={plan.key}
                    className={cn(
                      "relative rounded-xl border p-5 flex flex-col gap-4 transition-colors",
                      isCurrent
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card",
                      plan.key === "pro" && !isCurrent
                        ? "border-primary/30 shadow-[0_0_30px_-12px_hsl(var(--primary)/0.25)]"
                        : "",
                    )}
                  >
                    {plan.key === "pro" && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="whitespace-nowrap rounded-full bg-primary px-3 py-0.5 text-[11px] font-medium text-primary-foreground">
                          Most Popular
                        </span>
                      </div>
                    )}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Icon size={16} className="text-primary" />
                          <span className="text-sm font-medium text-foreground">{plan.name}</span>
                        </div>
                        {isCurrent && <Check size={13} className="text-primary" />}
                      </div>
                      <div className="flex items-baseline gap-1 mb-0.5">
                        <span className="text-lg font-light text-foreground">{plan.price}</span>
                        <span className="text-xs text-muted-foreground">{plan.priceSub}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2.5 leading-relaxed">
                        {plan.desc}
                      </p>
                      <ul className="space-y-1">
                        {plan.features.map((f) => (
                          <li
                            key={f}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <Check size={10} className="text-primary mt-0.5 shrink-0" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {isCurrent ? (
                      <span className="text-xs text-primary font-medium">Current plan</span>
                    ) : isUpgrade ? (
                      <button
                        onClick={() => handleUpgrade(plan.key)}
                        disabled={billingLoading !== null}
                        className="flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-lg py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {billingLoading === plan.key ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Crown size={12} />
                        )}
                        Upgrade
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Lower tier</span>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}

        {/* Download CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.24 }}
        >
          <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">Download Yomi</p>
              <p className="text-xs text-muted-foreground mt-0.5">Get the Windows desktop app.</p>
            </div>
            <Link
              href="/#download"
              className="flex items-center gap-2 bg-primary text-primary-foreground rounded-xl font-medium px-4 py-2 text-sm hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              <Download size={14} />
              Download
            </Link>
          </div>
        </motion.div>

        </> /* end account tab */}
      </main>

      {/* API Key modal */}
      {apiKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div>
              <h2 className="text-lg font-light text-foreground" style={{ letterSpacing: "-0.02em" }}>
                Add API Key
              </h2>
              {apiKeyModal.docsUrl && (
                <a
                  href={apiKeyModal.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  <ExternalLink size={10} />
                  How to get your API key
                </a>
              )}
            </div>
            <div className="space-y-3">
              {apiKeyModal.fields.map((field) => (
                <div key={field.name}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-widest">
                    {field.label}
                  </label>
                  <input
                    type={field.secret ? "password" : "text"}
                    placeholder={field.placeholder}
                    value={apiKeyValues[field.name] ?? ""}
                    onChange={(e) =>
                      setApiKeyValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitApiKey()}
                    className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                    autoFocus
                  />
                </div>
              ))}
            </div>
            {apiKeyError && <p className="text-xs text-destructive">{apiKeyError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setApiKeyModal(null)}
                className="flex-1 text-sm text-muted-foreground border border-border rounded-xl px-4 py-2.5 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitApiKey}
                disabled={apiKeySubmitting || apiKeyModal.fields.some((f) => !apiKeyValues[f.name]?.trim())}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium px-4 py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {apiKeySubmitting && <Loader2 size={14} className="animate-spin" />}
                Connect
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection string modal */}
      {dsnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h2 className="text-lg font-light text-foreground" style={{ letterSpacing: "-0.02em" }}>
              {dsnModal.field.label}
            </h2>
            <input
              type="text"
              placeholder={dsnModal.field.placeholder}
              value={dsnValue}
              onChange={(e) => setDsnValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmitDsn()}
              className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              autoFocus
            />
            {dsnError && <p className="text-xs text-destructive">{dsnError}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDsnModal(null)}
                className="flex-1 text-sm text-muted-foreground border border-border rounded-xl px-4 py-2.5 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitDsn}
                disabled={dsnSubmitting || !dsnValue.trim()}
                className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium px-4 py-2.5 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {dsnSubmitting && <Loader2 size={14} className="animate-spin" />}
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  return <DashboardContent />
}
