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
  Trash2,
  AlertTriangle,
  WalletCards,
  ReceiptText,
  Plug,
  ExternalLink,
  Zap,
  Home,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { openExternal } from "@/lib/telegram-webapp"
import { cn } from "@/lib/utils"
import { formatUsd } from "@/lib/local-price"
import { PLANS } from "@/lib/plans"
import { MemoryManager } from "@/components/dashboard/MemoryManager"
import { PrivacyManager } from "@/components/dashboard/PrivacyManager"
import { SchedulesManager } from "@/components/dashboard/SchedulesManager"
import { ReferralsManager } from "@/components/dashboard/ReferralsManager"
import { StreaksManager } from "@/components/dashboard/StreaksManager"
import { ConversationManager } from "@/components/dashboard/ConversationManager"
import { StatusManager } from "@/components/dashboard/StatusManager"
import { SettingsMenu, type DashboardTab } from "@/components/dashboard/SettingsMenu"
import { DashboardHome, type PlanSummary } from "@/components/dashboard/DashboardHome"
import { TelegramCard } from "@/components/dashboard/TelegramCard"
import {
  ConnectorMarketplace,
  CustomMcpServers,
  NextStepCard,
  buildCatalog,
  type CustomMcpServerInfo,
} from "@yomi/ui-connectors"

type IntegrationHealth = {
  provider: string
  displayName: string
  connected: boolean
  healthy: boolean
  status: "connected" | "needs_reconnect"
  message: string | null
  updatedAt: string
}

type ResetKind = "renewal" | "none"

type Sub = {
  role: string
  plan: string
  status: string
  trialExpired: boolean
  currentPeriodEnd: string | null
  dodoSubscriptionId: string | null
  resetAt: string | null
  resetKind: ResetKind
  billingWarning: string | null
  credits: {
    balance: number
    lifetimeGranted: number
    lifetimeConsumed: number
    lifetimeRefunded: number
    expiringSoon: number
    expiringSoonAt: string | null
  }
  creditsUsed: number
  totalCredits: number
  creditPacks: Array<{
    key: string
    name: string
    credits: number
    priceCents: number
    priceDisplay: string
    currency: string
  }>
}

type UsageSummary = {
  plan: { key: string; name: string; status: string }
  credits: {
    remaining: number
    included: number
    used: number
    totalAvailableThisPeriod: number
    resetAt: string | null
    resetKind: ResetKind
    expiringSoon: number
    expiringSoonAt: string | null
  }
  monthlyUsage: { days: Array<{ date: string; credits: number }> }
  recentActivity: Array<{
    id: string
    label: string
    category: string
    credits: number
    createdAt: string
  }>
  actions: { canBuyCredits: boolean; canUpgrade: boolean; upgradeUrl: string }
}

function inDays(value: string) {
  const days = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 86_400_000))
  if (days === 0) return "today"
  return `in ${days} day${days === 1 ? "" : "s"}`
}

// Explore renews monthly just like a paid plan now (see explore-renewal.ts's cron).
function creditsCaption(included: number, resetAt?: string | null, resetKind?: ResetKind | null) {
  if (resetKind === "renewal" && resetAt) {
    return `${included.toLocaleString()} included monthly credits. Resets ${inDays(resetAt)}.`
  }
  return `${included.toLocaleString()} included monthly credits.`
}

type PlatformLink = { platform: string; connectedAt: string }

function DashboardContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [sub, setSub] = useState<Sub | null>(null)
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null)
  const [subPending, setSubPending] = useState(true)
  const [subLoadError, setSubLoadError] = useState("")
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const [billingError, setBillingError] = useState("")
  const [creditLoading, setCreditLoading] = useState<string | null>(null)
  const [desiredPlan, setDesiredPlan] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [activeTab, setActiveTab] = useState<DashboardTab>("home")
  const [highlightConnectorId, setHighlightConnectorId] = useState<string | null>(null)
  const [connectedProviders, setConnectedProviders] = useState<string[]>([])
  const [customServers, setCustomServers] = useState<CustomMcpServerInfo[]>([])
  const [customMcpAdding, setCustomMcpAdding] = useState(false)
  const [customMcpError, setCustomMcpError] = useState("")
  const [agentSoulDraft, setAgentSoulDraft] = useState("")
  const [agentSoulSaving, setAgentSoulSaving] = useState(false)
  const [agentSoulError, setAgentSoulError] = useState("")
  const [integrationHealth, setIntegrationHealth] = useState<IntegrationHealth[]>([])
  const [integrationLoadingId, setIntegrationLoadingId] = useState<string | null>(null)
  const [integrationConnectError, setIntegrationConnectError] = useState("")
  const [integrationBanner, setIntegrationBanner] = useState<
    { kind: "success" } | { kind: "error"; message: string } | null
  >(null)
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

    fetch("/api/billing/usage-summary", {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: UsageSummary | null) => setUsageSummary(d))
      .catch(() => setUsageSummary(null))
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
        const summaryRes = await fetch("/api/billing/usage-summary", {
          headers: { Authorization: `Bearer ${session.session.token}` },
        })
        if (summaryRes.ok) setUsageSummary((await summaryRes.json()) as UsageSummary)
      } catch {
        /* ignore polling errors */
      }
    }, 30_000)
    return () => clearInterval(interval)
  }, [session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDesiredPlan(params.get("plan"))
    if (params.has("welcome")) setShowWelcome(true)

    const success = params.has("integration_success")
    const error = params.get("integration_error")
    const connect = params.get("connect")
    if (success || error) {
      setActiveTab("integrations")
      setIntegrationBanner(success ? { kind: "success" } : { kind: "error", message: error ?? "" })
    }
    if (connect) {
      setActiveTab("integrations")
      setHighlightConnectorId(connect)
    }
    if (success || error || connect) {
      // Strip one-shot flags from the URL. The banner used to be rendered straight off
      // window.location.search, so it reappeared on every reload — announcing a
      // successful connection long after the fact, and even when nothing was connected.
      // Same reasoning applies to `connect`: it's a one-time entry point, not
      // permanent state tied to the URL.
      params.delete("integration_success")
      params.delete("integration_error")
      params.delete("connect")
      const qs = params.toString()
      window.history.replaceState({}, "", qs ? `?${qs}` : window.location.pathname)
    }
  }, [])

  // A success banner is a transient confirmation, not a permanent state.
  useEffect(() => {
    if (integrationBanner?.kind !== "success") return
    const t = setTimeout(() => setIntegrationBanner(null), 5000)
    return () => clearTimeout(t)
  }, [integrationBanner])

  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/integrations/status?health=1`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : { connected: [], integrations: [] }))
      .then((d: { connected: string[]; integrations?: IntegrationHealth[] }) => {
        setConnectedProviders(d.connected)
        setIntegrationHealth(Array.isArray(d.integrations) ? d.integrations : [])
      })
      .catch(() => {}) // ignore — integrations tab is best-effort
  }, [session])

  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/custom-mcp`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : { servers: [] }))
      .then((d: { servers?: CustomMcpServerInfo[] }) => {
        setCustomServers(Array.isArray(d.servers) ? d.servers : [])
      })
      .catch(() => {}) // ignore — best-effort, same as the integrations fetch above
  }, [session])

  useEffect(() => {
    if (!session) return
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
    fetch(`${apiBase}/api/user/me`, {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { agentSoul?: string | null } | null) => {
        if (d?.agentSoul) setAgentSoulDraft(d.agentSoul)
      })
      .catch(() => {}) // ignore — best-effort, same as the fetch above
  }, [session])

  useEffect(() => {
    if (!session) return
    const token = session.session.token
    let cancelled = false
    const load = () => {
      fetch("/api/gateway/connections", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d: PlatformLink[]) => {
          if (!cancelled) setPlatformLinks(Array.isArray(d) ? d : [])
        })
        .catch(() => {
          if (!cancelled) setPlatformLinks([])
        })
        .finally(() => {
          if (!cancelled) setPlatformsLoading(false)
        })
    }
    load()
    // Re-check when the user returns to this tab/window — linking happens on Telegram
    // (often on another device), so the connection appears without a manual reload.
    const onFocus = () => load()
    const onVisible = () => {
      if (document.visibilityState === "visible") load()
    }
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
      openExternal(data.short_url)
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
        const data = (await res.json()) as {
          kind: string
          fields?: Array<{ name: string; label: string; placeholder?: string; secret: boolean }>
          field?: { label: string; placeholder: string }
          docsUrl?: string
        }
        if (data.kind === "api_key" && data.fields) {
          setApiKeyModal({ id, fields: data.fields, docsUrl: data.docsUrl })
          setApiKeyValues({})
          setApiKeyError("")
        } else if (data.kind === "connection_string" && data.field) {
          setDsnModal({ id, field: data.field })
          setDsnValue("")
          setDsnError("")
        }
      } catch {
        /* best-effort */
      } finally {
        setIntegrationLoadingId(null)
      }
      return
    }

    // OAuth2 / Composio: navigate directly — backend authenticates via token query param
    openExternal(
      `${apiBase}/api/integrations/connect/${id}?session=${encodeURIComponent(session!.session.token)}`,
    )
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
      const data = (await res.json()) as { ok?: boolean; error?: string }
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
      const data = (await res.json()) as { ok?: boolean; error?: string }
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
    } catch {
      /* best-effort */
    } finally {
      setIntegrationLoadingId(null)
    }
  }

  async function handleAddCustomMcpServer(input: { name: string; url: string; apiKey: string }) {
    if (!session) return
    setCustomMcpError("")
    setCustomMcpAdding(true)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${apiBase}/api/custom-mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify(input),
      })
      const data = (await res.json()) as { server?: CustomMcpServerInfo; error?: string }
      if (!res.ok || !data.server) throw new Error(data.error ?? "Failed to add server")
      setCustomServers((prev) => [...prev, data.server as CustomMcpServerInfo])
    } catch (err) {
      setCustomMcpError(err instanceof Error ? err.message : "Failed to add server")
    } finally {
      setCustomMcpAdding(false)
    }
  }

  async function handleDeleteCustomMcpServer(id: string) {
    if (!session) return
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      await fetch(`${apiBase}/api/custom-mcp/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.session.token}` },
      })
      setCustomServers((prev) => prev.filter((s) => s.id !== id))
    } catch {
      /* best-effort */
    }
  }

  async function handleSaveAgentSoul() {
    if (!session) return
    setAgentSoulError("")
    setAgentSoulSaving(true)
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ""
      const res = await fetch(`${apiBase}/api/user/profile`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
        body: JSON.stringify({ agentSoul: agentSoulDraft }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "Failed to save")
    } catch (err) {
      setAgentSoulError(err instanceof Error ? err.message : "Failed to save")
    } finally {
      setAgentSoulSaving(false)
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
    // Revoke all sessions server-side (multi-device), then clear this one.
    await authClient.revokeSessions().catch(() => {})
    await authClient.signOut()
    router.push("/")
  }

  if (isPending || !session) return null

  const currentPlanKey = sub?.plan ?? "explore"
  const currentPlanIdx = PLANS.findIndex((p) => p.key === currentPlanKey)
  const creditRemaining = usageSummary?.credits.remaining ?? sub?.credits?.balance ?? 0
  const creditUsed = usageSummary?.credits.used ?? sub?.creditsUsed ?? 0
  const creditTotal =
    usageSummary?.credits.totalAvailableThisPeriod ?? sub?.totalCredits ?? creditRemaining
  const creditIncluded =
    usageSummary?.credits.included ??
    ({ explore: 100, pro: 300, max: 750 } as Record<string, number>)[currentPlanKey] ??
    0
  const resetAt = usageSummary?.credits.resetAt ?? sub?.resetAt
  const resetKind = usageSummary?.credits.resetKind ?? sub?.resetKind
  const trendDays = usageSummary?.monthlyUsage.days.slice(-14) ?? []
  const trendMax = Math.max(...trendDays.map((d) => d.credits), 1)
  const recentActivity = usageSummary?.recentActivity ?? []

  const planStatusTone: PlanSummary["statusTone"] =
    sub?.status === "active" ? "active" : sub?.status === "past_due" ? "past_due" : "trial"
  const planStatusLabel =
    sub?.status === "past_due"
      ? "past due"
      : sub?.plan === "explore"
        ? "free"
        : (sub?.status ?? "trial")
  const planSummary: PlanSummary = {
    loading: subPending,
    available: !!sub,
    planName: sub ? (PLANS.find((p) => p.key === currentPlanKey)?.name ?? currentPlanKey) : "",
    statusLabel: planStatusLabel,
    statusTone: planStatusTone,
    creditRemaining,
    creditTotal: creditTotal || creditIncluded,
    caption: creditsCaption(creditIncluded, resetAt, resetKind),
    renewsAt: sub?.currentPeriodEnd ?? null,
    billingWarning: sub?.billingWarning ?? null,
  }

  return (
    <div className="site-texture-bg min-h-dvh text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="font-display text-xl font-bold text-foreground select-none shrink-0"
          >
            Yomi
          </Link>
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {session.user.email}
            </span>
            <SettingsMenu onNavigate={setActiveTab} />
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
            {(["home", "integrations"] as const).map((tab) => (
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
                {tab === "home" && <Home size={13} />}
                {tab === "integrations" && <Plug size={13} />}
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
        {activeTab === "home" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <DashboardHome
              token={session.session.token}
              recentActivity={recentActivity}
              plan={planSummary}
              connectedProviders={connectedProviders}
              unhealthyCount={integrationHealth.filter((item) => !item.healthy).length}
              currentPlanKey={currentPlanKey}
              creditPacks={sub?.creditPacks ?? []}
              billingLoading={billingLoading}
              creditLoading={creditLoading}
              billingError={billingError}
              formatPlanPrice={formatUsd}
              formatPackPrice={(pack) => pack.priceDisplay}
              onUpgrade={handleUpgrade}
              onBuyCredits={handleBuyCredits}
              onNavigate={setActiveTab}
              platformLinks={platformLinks}
              platformsLoading={platformsLoading}
              unlinkingPlatform={unlinking}
              onUnlinkPlatform={handleUnlink}
            />
          </motion.div>
        )}

        {activeTab === "integrations" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {integrationBanner?.kind === "success" && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-400">
                Integration connected successfully.
              </div>
            )}
            {integrationBanner?.kind === "error" && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <span>Integration failed: {integrationBanner.message}</span>
                <button
                  type="button"
                  onClick={() => setIntegrationBanner(null)}
                  className="shrink-0 opacity-70 hover:opacity-100"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
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
                      <p className="text-sm font-medium text-yellow-300">
                        Some integrations need reconnecting
                      </p>
                      <p className="text-xs text-yellow-200/75 mt-1">
                        Yomi will avoid stale tokens once you reconnect these providers.
                      </p>
                    </div>
                    <div className="grid gap-2">
                      {integrationHealth
                        .filter((item) => !item.healthy)
                        .map((item) => (
                          <div
                            key={item.provider}
                            className="flex flex-col gap-2 rounded-xl bg-background/50 border border-yellow-500/15 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">{item.displayName}</p>
                              <p className="text-xs text-muted-foreground break-words line-clamp-2">
                                {item.message ?? "Authentication failed"}
                              </p>
                            </div>
                            <button
                              onClick={() => handleConnectIntegration(item.provider)}
                              className="shrink-0 self-start rounded-lg bg-yellow-400 text-black px-3 py-1.5 text-xs font-medium hover:bg-yellow-300 transition-colors sm:self-auto"
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
            <div className="flex flex-col gap-8 sm:gap-10">
              <NextStepCard connectedIds={connectedProviders} appUrl={window.location.origin} />
              <ConnectorMarketplace
                connectors={buildCatalog(
                  connectedProviders,
                  Object.fromEntries(integrationHealth.map((i) => [i.provider, i.displayName])),
                )}
                onConnect={handleConnectIntegration}
                onDisconnect={handleDisconnectIntegration}
                loadingId={integrationLoadingId}
                highlightId={highlightConnectorId}
              />
              <CustomMcpServers
                servers={customServers}
                onAdd={handleAddCustomMcpServer}
                onDelete={handleDeleteCustomMcpServer}
                adding={customMcpAdding}
                addError={customMcpError}
              />
            </div>
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

        {/* Privacy tab */}
        {activeTab === "privacy" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <PrivacyManager token={session.session.token} />
          </motion.div>
        )}

        {/* Referrals tab */}
        {activeTab === "referrals" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <ReferralsManager token={session.session.token} />
          </motion.div>
        )}

        {/* Streaks tab */}
        {activeTab === "streaks" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <StreaksManager token={session.session.token} />
          </motion.div>
        )}

        {/* Writing style tab */}
        {activeTab === "writing-style" && session && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                Writing style
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Teach Yomi how to talk to you — e.g. &quot;always be terse, no emoji.&quot;
              </p>
              <textarea
                value={agentSoulDraft}
                onChange={(e) => setAgentSoulDraft(e.target.value)}
                placeholder="e.g. always be terse, no emoji"
                rows={4}
                className="w-full rounded-lg border border-border bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {agentSoulError && <p className="text-xs text-destructive mt-2">{agentSoulError}</p>}
              <button
                onClick={handleSaveAgentSoul}
                disabled={agentSoulSaving}
                className="mt-3 flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-4 py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {agentSoulSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </motion.div>
        )}

        {/* Profile tab content */}
        {activeTab === "profile" && (
          <>
            <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">{session.user.name || "—"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{session.user.email}</p>
              </div>
            </div>

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
                    Connect Telegram or an integration to start using Yomi from the dashboard.
                  </p>
                  <Link
                    href="/docs"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Open docs
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

            {/* Telegram */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <TelegramCard
                platformLinks={platformLinks}
                platformsLoading={platformsLoading}
                unlinking={unlinking}
                onUnlink={handleUnlink}
              />
            </motion.div>
          </>
        )}

        {/* Billing tab content */}
        {
          activeTab === "billing" && (
            <>
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
                            sub.status === "active"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : sub.status === "past_due"
                                ? "bg-red-500/10 text-red-400"
                                : "bg-sky-500/10 text-sky-300",
                          )}
                        >
                          {sub.status === "past_due"
                            ? "past due"
                            : sub.plan === "explore"
                              ? "free"
                              : sub.status}
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
                      {cancelling ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Trash2 size={12} />
                      )}
                      Cancel subscription
                    </button>
                  )}
                </div>
              </motion.div>

              {/* Usage section — public credit abstraction */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.12 }}
              >
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-6 mb-6">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                          Credits remaining
                        </p>
                        <div className="flex items-baseline gap-2">
                          <span className="text-4xl font-light text-foreground tabular-nums">
                            {creditRemaining}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            / {creditTotal || creditIncluded} available
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {creditsCaption(creditIncluded, resetAt, resetKind)}
                        </p>
                      </div>
                      <button
                        onClick={() =>
                          sub?.plan === "explore"
                            ? handleUpgrade("pro")
                            : sub?.creditPacks?.[0] && handleBuyCredits(sub.creditPacks[0].key)
                        }
                        disabled={billingLoading !== null || creditLoading !== null}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                      >
                        {sub?.plan === "explore" ? <Crown size={13} /> : <Zap size={13} />}
                        {sub?.plan === "explore" ? "Upgrade" : "Add credits"}
                      </button>
                    </div>

                    {sub && (
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <div className="h-3 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{
                                width: `${Math.min(100, (creditUsed / Math.max(creditTotal, 1)) * 100)}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{creditUsed} used this period</span>
                            <span>{creditRemaining} remaining</span>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
                          <div className="rounded-xl border border-border bg-background/45 p-4">
                            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                              Monthly usage
                            </p>
                            <p className="mt-2 text-2xl font-light tabular-nums text-foreground">
                              {creditUsed}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Credits used since the current period began.
                            </p>
                          </div>
                          <div className="rounded-xl border border-border bg-background/45 p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                                Daily trend
                              </p>
                              <span className="text-xs text-muted-foreground">
                                Last {trendDays.length || 0} days
                              </span>
                            </div>
                            {trendDays.length > 0 ? (
                              <div className="flex h-16 items-end gap-1.5">
                                {trendDays.map((day) => (
                                  <div
                                    key={day.date}
                                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                                  >
                                    <div
                                      className="w-full rounded-t bg-primary/80"
                                      style={{
                                        height: `${Math.max(4, (day.credits / trendMax) * 56)}px`,
                                      }}
                                      title={`${day.date}: ${day.credits} credits`}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                No usage yet this period.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {sub?.plan === "explore" && sub?.credits?.balance === 0 && (
                      <div className="mt-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                        <p className="text-sm text-destructive font-medium mb-1">
                          Out of free credits for this month
                        </p>
                        <p className="text-xs text-destructive/80 mb-3">
                          {sub.trialExpired
                            ? "Your free credits are renewing — check back in a moment, or upgrade to Pro or Max to skip the wait."
                            : "You've used all your free credits for this month. They renew automatically, or upgrade to Pro or Max for more right now."}
                        </p>
                        <button
                          onClick={() => handleUpgrade("pro")}
                          disabled={billingLoading !== null}
                          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Crown size={12} />
                          Subscribe to Pro · $5/mo
                        </button>
                      </div>
                    )}

                    {sub?.plan !== "explore" && sub?.credits?.balance === 0 && (
                      <div className="mt-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                        <p className="text-sm text-yellow-400 font-medium mb-1">
                          No credits remaining
                        </p>
                        <p className="text-xs text-yellow-400/80 mb-3">
                          You've used all your credits for this period. Buy a credit pack below to
                          keep going
                          {sub?.resetAt
                            ? `, or they reset on ${new Date(sub.resetAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`
                            : ""}
                          .
                        </p>
                        <button
                          onClick={() =>
                            sub?.creditPacks?.[0] && handleBuyCredits(sub.creditPacks[0].key)
                          }
                          disabled={creditLoading !== null || !sub?.creditPacks?.length}
                          className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                        >
                          <Zap size={12} />
                          Buy {sub?.creditPacks?.[0]?.name ?? "credits"}
                        </button>
                      </div>
                    )}

                    {connectedProviders.length > 0 && (
                      <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-background/40 px-4 py-3 text-sm">
                        <span className="flex items-center gap-2 text-muted-foreground">
                          <Plug size={15} />
                          App connectors
                        </span>
                        <span className="text-foreground tabular-nums">
                          {connectedProviders.length} connected
                        </span>
                      </div>
                    )}
                  </div>
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
                        Credits and activity
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
                                ? ` on ${new Date(sub.credits.expiringSoonAt).toLocaleDateString(
                                    "en-US",
                                    {
                                      month: "short",
                                      day: "numeric",
                                    },
                                  )}`
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
                            <span className="block text-sm font-medium text-foreground">
                              {pack.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {creditLoading === pack.key ? "Starting..." : pack.priceDisplay}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="w-full sm:w-auto">
                        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center">
                          <p className="text-xs text-muted-foreground mb-2">
                            Add credits on Pro or Max
                          </p>
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

                  {recentActivity.length > 0 && (
                    <div className="border-t border-border pt-4">
                      <div className="flex items-center gap-2 mb-3">
                        <ReceiptText size={14} className="text-muted-foreground" />
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                          Recent activity
                        </p>
                      </div>
                      <div className="space-y-2">
                        {recentActivity.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between gap-4 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="text-foreground">{item.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(item.createdAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                            <p className="shrink-0 tabular-nums text-muted-foreground">
                              {item.credits} credits
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>

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
                          isCurrent ? "border-primary bg-primary/5" : "border-border bg-card",
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
                              <span className="text-sm font-medium text-foreground">
                                {plan.name}
                              </span>
                            </div>
                            {isCurrent && <Check size={13} className="text-primary" />}
                          </div>
                          <div className="flex items-baseline gap-1 mb-0.5">
                            <span className="text-lg font-light text-foreground">
                              {formatUsd(plan.priceUsd)}
                            </span>
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
            </>
          ) /* end billing tab */
        }
      </main>

      {/* API Key modal */}
      {apiKeyModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <div>
              <h2
                className="text-lg font-light text-foreground"
                style={{ letterSpacing: "-0.02em" }}
              >
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
                disabled={
                  apiKeySubmitting || apiKeyModal.fields.some((f) => !apiKeyValues[f.name]?.trim())
                }
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
