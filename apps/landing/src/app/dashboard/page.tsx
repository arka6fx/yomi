"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import {
  LogOut,
  Check,
  Zap,
  Crown,
  Loader2,
  Download,
  Shield,
  Sparkles,
  Cuboid,
  Trash2,
  ExternalLink,
  Plus,
  MessageCircle,
  AlertTriangle,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

type FeatureUsage = { used: number; limit: number | null }

type Sub = {
  role: string
  plan: string
  status: string
  trialEndDate: string | null
  currentPeriodEnd: string | null
  razorpaySubId: string | null
  requestsUsed: number
  requestsLimit: number | null
  requestsRemaining: number | null
  resetAt: string | null
  billingWarning: string | null
  features: {
    chat: FeatureUsage
    voice: FeatureUsage
    screenshots: FeatureUsage
    reasoning: FeatureUsage
    desktopAutomation: FeatureUsage
    browserAutomation: FeatureUsage
    gatewayMessages: FeatureUsage
  }
  dailyChatUsed: number
  dailyVoiceUsed: number
  dailyImageUsed: number
  tokensUsedThisPeriod: number
}

const PLANS = [
  {
    key: "explore",
    name: "Explore",
    price: "Free",
    priceSub: "forever",
    annual: "$0 / year",
    desc: "Free screen-aware AI with monthly limits.",
    icon: Sparkles,
    features: [
      "100 AI chats / month",
      "20 min voice / month",
      "25 screenshot analyses",
      "50 local memories",
      "Messaging bots (limited)",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$14.99",
    priceSub: "/ mo",
    annual: "$144 / year",
    desc: "Daily voice, screen, memory, and useful automation.",
    icon: Crown,
    features: [
      "2,000 AI chats / month",
      "100 reasoning uses",
      "75 desktop automation runs",
      "40 browser automation runs",
      "Messaging bots (full access)",
    ],
  },
  {
    key: "max",
    name: "Max",
    price: "$39.99",
    priceSub: "/ mo",
    annual: "$384 / year",
    desc: "Power-user automation, reasoning, and creation limits.",
    icon: Cuboid,
    features: [
      "Everything in Pro",
      "8,000 AI chats / month",
      "500 reasoning uses",
      "750 desktop automation runs",
      "500 browser automation runs",
      "Early access features",
      "Messaging bots (priority)",
    ],
  },
]

type PlatformLink = { platform: string; connectedAt: string }

const PLATFORM_META: Record<string, { name: string; color: string; inviteUrl: string }> = {
  telegram: {
    name: "Telegram",
    color: "bg-sky-500/10 text-sky-400",
    inviteUrl: "https://t.me/yomi_assistant_bot",
  },
  discord: {
    name: "Discord",
    color: "bg-indigo-500/10 text-indigo-400",
    inviteUrl: `${process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001"}/api/gateway/discord/auth`,
  },
}

function DashboardContent() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()

  const [sub, setSub] = useState<Sub | null>(null)
  const [subPending, setSubPending] = useState(true)
  const [billingLoading, setBillingLoading] = useState<string | null>(null)
  const [billingError, setBillingError] = useState("")
  const [desiredPlan, setDesiredPlan] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

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
      .then((d: Sub) => setSub(d))
      .catch(() =>
        setSub({
          role: "user",
          plan: "explore",
          status: "inactive",
          trialEndDate: null,
          currentPeriodEnd: null,
          requestsUsed: 0,
          requestsLimit: 100,
          requestsRemaining: 100,
          resetAt: null,
          features: {
            chat: { used: 0, limit: 100 },
            voice: { used: 0, limit: 20 },
            screenshots: { used: 0, limit: 25 },
            reasoning: { used: 0, limit: 0 },
            desktopAutomation: { used: 0, limit: 0 },
            browserAutomation: { used: 0, limit: 0 },
            gatewayMessages: { used: 0, limit: 50 },
          },
          razorpaySubId: null,
          billingWarning: null,
          dailyChatUsed: 0,
          dailyVoiceUsed: 0,
          dailyImageUsed: 0,
          tokensUsedThisPeriod: 0,
        }),
      )
      .finally(() => setSubPending(false))
  }, [session])

  useEffect(() => {
    if (!session) return
    fetch("/api/gateway/connections", {
      headers: { Authorization: `Bearer ${session.session.token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: PlatformLink[]) => setPlatformLinks(Array.isArray(d) ? d : []))
      .catch(() => setPlatformLinks([]))
      .finally(() => setPlatformsLoading(false))
  }, [session])

  useEffect(() => {
    setDesiredPlan(new URLSearchParams(window.location.search).get("plan"))
  }, [])

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
    if (!sub?.razorpaySubId) return
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

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/")
  }

  async function handleUnlink(platform: string) {
    setUnlinking(platform)
    try {
      const res = await fetch(
        `/api/gateway/connections/${platform}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${session!.session.token}`,
          },
        },
      )
      if (res.ok) {
        setPlatformLinks((prev) =>
          prev.filter((p) => p.platform !== platform),
        )
      }
    } catch {
      // ignore
    } finally {
      setUnlinking(null)
    }
  }

  if (isPending || !session) return null

  const isOwner = sub?.role === "owner"
  const currentPlanKey = sub?.plan ?? "explore"
  const currentPlanIdx = PLANS.findIndex((p) => p.key === currentPlanKey)

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="fixed inset-0 pointer-events-none">
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full blur-[160px]"
          style={{ background: "radial-gradient(circle, rgba(255,175,80,0.05), transparent 65%)" }}
        />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="font-display text-xl font-bold text-foreground select-none">
            Yomi
          </Link>
          <div className="flex items-center gap-4">
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

      <main className="max-w-4xl mx-auto px-6 py-12 space-y-10 relative z-10">
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

        {/* Plan card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
        >
          <div className="rounded-2xl border border-border bg-card p-6 flex flex-wrap items-start justify-between gap-6">
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
                    ? "—"
                    : (PLANS.find((p) => p.key === currentPlanKey)?.name ?? currentPlanKey)}
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
                    {isOwner ? "owner" : sub.status === "past_due" ? "past due" : sub.status}
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
            {sub?.razorpaySubId && sub.plan !== "explore" && (
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

        {/* Usage section — per-feature breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.12 }}
        >
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-6 mb-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                  Usage this month
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-light text-foreground">
                    {sub?.requestsRemaining ?? "—"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {sub?.requestsLimit !== null && sub?.requestsLimit !== undefined
                      ? `requests left of ${sub.requestsLimit}`
                      : "unlimited requests"}
                  </span>
                </div>
                {sub?.resetAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Resets{" "}
                    {new Date(sub.resetAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                )}
              </div>
            </div>

            {sub?.requestsRemaining === 0 && sub?.requestsLimit !== null && (
              <div className="mb-6 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">
                  You've used all requests for this month. Upgrade to continue or wait for the reset.
                </p>
              </div>
            )}

            {/* Per-feature bars */}
            {sub?.features && (
              <div className="space-y-4">
                {([
                  { key: "chat" as const, label: "AI Chats", icon: "💬" },
                  { key: "voice" as const, label: "Voice Interactions", icon: "🎤" },
                  { key: "screenshots" as const, label: "Screenshot Analyses", icon: "📸" },
                  { key: "desktopAutomation" as const, label: "Desktop Automation", icon: "🖥️" },
                  { key: "browserAutomation" as const, label: "Browser Automation", icon: "🌐" },
                  { key: "gatewayMessages" as const, label: "Messaging Bots", icon: "💭" },
                ]).map(({ key, label, icon }) => {
                  const feat = sub.features[key]
                  if (!feat) return null
                  const pct = feat.limit && feat.limit > 0 ? Math.min(100, (feat.used / feat.limit) * 100) : 0
                  const isUnlimited = feat.limit === null
                  const isDisabled = feat.limit === 0

                  return (
                    <div key={key} className={cn("space-y-1.5", isDisabled && "opacity-40")}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-foreground">
                          <span className="text-base">{icon}</span>
                          {label}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {isDisabled ? (
                            "Not available"
                          ) : isUnlimited ? (
                            `${feat.used} used`
                          ) : (
                            `${feat.used} / ${feat.limit}`
                          )}
                        </span>
                      </div>
                      {!isDisabled && !isUnlimited && (
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-yellow-500" : "bg-primary",
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
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

                return (
                  <div
                    key={plan.key}
                    className={cn(
                      "rounded-xl border p-4 flex flex-col gap-3 transition-colors",
                      isCurrent
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card",
                    )}
                  >
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-sm font-medium text-foreground">{plan.name}</span>
                        {isCurrent && <Check size={13} className="text-primary" />}
                      </div>
                      <div className="flex items-baseline gap-0.5 mb-0.5">
                        <span className="text-xl font-light text-foreground">{plan.price}</span>
                        <span className="text-xs text-muted-foreground">{plan.priceSub}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-1">{plan.annual}</p>
                      <p className="text-xs text-muted-foreground mb-2 leading-relaxed">
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

        {/* Linked accounts */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                  Linked accounts
                </p>
                <p className="text-sm text-muted-foreground">
                  Connect Telegram or Discord to chat with Yomi from anywhere.
                </p>
              </div>
              <Link
                href="/link"
                className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-xl font-medium px-3 py-1.5 text-xs hover:bg-primary/90 transition-colors shrink-0"
              >
                <Plus size={12} />
                Link new
              </Link>
            </div>

            {platformsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </div>
            ) : platformLinks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-4 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  No accounts linked yet. Message the Yomi bot to get started.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {Object.entries(PLATFORM_META).map(([key, meta]) =>
                    meta.inviteUrl ? (
                      <a
                        key={key}
                        href={meta.inviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs bg-muted hover:bg-muted/80 text-foreground rounded-lg px-3 py-1.5 transition-colors"
                      >
                        <MessageCircle size={12} />
                        {meta.name === "Discord" ? "Add " + meta.name : "Add " + meta.name + " bot"}
                        <ExternalLink size={10} />
                      </a>
                    ) : null,
                  )}

                </div>
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
                      className="flex items-center justify-between rounded-xl border border-border px-4 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "text-xs px-2 py-0.5 rounded-full font-medium capitalize",
                            meta.color,
                          )}
                        >
                          {meta.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Connected{" "}
                          {new Date(link.connectedAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href="/link"
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Manage
                        </Link>
                        <button
                          onClick={() => handleUnlink(link.platform)}
                          disabled={unlinking === link.platform}
                          className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors disabled:opacity-50"
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
        </motion.div>

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
      </main>
    </div>
  )
}

export default function DashboardPage() {
  return <DashboardContent />
}
