"use client"

import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  Activity,
  AlertTriangle,
  Brain,
  Clock,
  Crown,
  ExternalLink,
  Flame,
  HeartPulse,
  Loader2,
  MessageSquare,
  Plug,
  Plus,
  Share2,
} from "lucide-react"
import { buildCatalog, ConnectorIcon } from "@yomi/ui-connectors"
import { cn } from "@/lib/utils"
import { PLANS } from "@/lib/plans"
import type { DashboardTab } from "./SettingsMenu"
import { TelegramCard, type PlatformLink } from "./TelegramCard"

export type CreditPack = {
  key: string
  name: string
  priceCents: number
  priceDisplay: string
}

type ConversationTurn = { role: "user" | "assistant" | "system"; content: string }

type ScheduleRow = {
  id: string
  schedule: string
  prompt: string
  enabled: boolean
  oneShot?: boolean
  nextRunAt?: string | null
  lastRunAt?: string | null
  lastRunStatus?: string | null
  lastRunError?: string | null
  runCount?: number
}

type MemoryRow = {
  id: string
  topic?: string | null
  kind?: string | null
  scope?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

type ReferralStats = {
  code: string
  count: number
  cap: number
  creditsEarned: number
}

type StreakStats = {
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
}

export type ActivityItem = {
  id: string
  label: string
  category: string
  credits: number
  createdAt: string
}

export type PlanSummary = {
  loading: boolean
  available: boolean
  planName: string
  statusLabel: string
  statusTone: "active" | "past_due" | "trial"
  creditRemaining: number
  creditTotal: number
  caption: string
  renewsAt: string | null
  billingWarning: string | null
}

const PLAN_TONE_CLASSES: Record<PlanSummary["statusTone"], string> = {
  active: "bg-emerald-500/10 text-emerald-400",
  past_due: "bg-red-500/10 text-red-400",
  trial: "bg-sky-500/10 text-sky-300",
}

function truncate(text: string, max: number) {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed
}

function relativePast(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function relativeFuture(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function PlanBanner({ plan, onClick }: { plan: PlanSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-border bg-card p-5 sm:p-6 text-left transition-colors hover:border-primary/40"
    >
      {plan.billingWarning && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          <AlertTriangle size={13} className="shrink-0" />
          {plan.billingWarning}
        </div>
      )}
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Current plan
          </p>
          <div className="flex items-center gap-2">
            <span
              className="text-2xl font-light text-foreground capitalize"
              style={{ letterSpacing: "-0.02em" }}
            >
              {plan.loading ? "…" : plan.available ? plan.planName : "Unavailable"}
            </span>
            {!plan.loading && plan.available && (
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium",
                  PLAN_TONE_CLASSES[plan.statusTone],
                )}
              >
                {plan.statusLabel}
              </span>
            )}
          </div>
          {plan.renewsAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Renews{" "}
              {new Date(plan.renewsAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
        </div>
        <div className="sm:text-right">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
            Credits remaining
          </p>
          <div className="flex items-baseline gap-2 sm:justify-end">
            <span className="text-3xl font-light text-foreground tabular-nums">
              {plan.creditRemaining}
            </span>
            <span className="text-sm text-muted-foreground">/ {plan.creditTotal} available</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{plan.caption}</p>
        </div>
      </div>
    </button>
  )
}

function StatCard({
  icon: Icon,
  title,
  loading,
  empty,
  emptyText,
  onClick,
  children,
}: {
  icon: typeof Clock
  title: string
  loading: boolean
  empty: boolean
  emptyText: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 sm:p-5 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <span className="text-xs font-medium uppercase tracking-widest">{title}</span>
      </div>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="text-sm text-foreground">{children}</div>
      )}
    </button>
  )
}

// Dashboard landing view: at-a-glance summary cards over data other tabs already
// fetch in full, plus a memory preview. Reuses existing endpoints only — no new backend.
export function DashboardHome({
  token,
  recentActivity,
  plan,
  connectedProviders,
  unhealthyCount,
  currentPlanKey,
  creditPacks,
  billingLoading,
  creditLoading,
  billingError,
  formatPlanPrice,
  formatPackPrice,
  onUpgrade,
  onBuyCredits,
  onNavigate,
  platformLinks,
  platformsLoading,
  unlinkingPlatform,
  onUnlinkPlatform,
}: {
  token: string
  recentActivity: ActivityItem[]
  plan: PlanSummary
  connectedProviders: string[]
  unhealthyCount: number
  currentPlanKey: string
  creditPacks: CreditPack[]
  billingLoading: string | null
  creditLoading: string | null
  billingError: string
  formatPlanPrice: (usd: number) => string
  formatPackPrice: (pack: CreditPack) => string
  onUpgrade: (planKey: string) => void
  onBuyCredits: (packKey: string) => void
  onNavigate: (tab: DashboardTab) => void
  platformLinks: PlatformLink[]
  platformsLoading: boolean
  unlinkingPlatform: string | null
  onUnlinkPlatform: (platform: string) => void
}) {
  const [history, setHistory] = useState<ConversationTurn[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [memoryLoading, setMemoryLoading] = useState(true)
  const [referral, setReferral] = useState<ReferralStats | null>(null)
  const [referralLoading, setReferralLoading] = useState(true)
  const [referralCopied, setReferralCopied] = useState(false)
  const [referralError, setReferralError] = useState("")
  const [streak, setStreak] = useState<StreakStats | null>(null)
  const [streakLoading, setStreakLoading] = useState(true)

  const auth = { Authorization: `Bearer ${token}` }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/conversation/shared", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { history?: ConversationTurn[] }
      setHistory((data.history ?? []).filter((t) => t.role !== "system"))
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [token])

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    try {
      const res = await fetch("/api/schedules", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { schedules?: ScheduleRow[] }
      setSchedules(data.schedules ?? [])
    } catch {
      setSchedules([])
    } finally {
      setSchedulesLoading(false)
    }
  }, [token])

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const res = await fetch("/api/memory/entries?limit=5", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { memories?: MemoryRow[] }
      setMemory(data.memories ?? [])
    } catch {
      setMemory([])
    } finally {
      setMemoryLoading(false)
    }
  }, [token])

  const loadReferral = useCallback(async () => {
    setReferralLoading(true)
    try {
      const res = await fetch("/api/referrals/me", { headers: auth })
      if (!res.ok) throw new Error("failed")
      setReferral((await res.json()) as ReferralStats)
    } catch {
      setReferral(null)
    } finally {
      setReferralLoading(false)
    }
  }, [token])

  const loadStreak = useCallback(async () => {
    setStreakLoading(true)
    try {
      const res = await fetch("/api/streaks/me", { headers: auth })
      if (!res.ok) throw new Error("failed")
      setStreak((await res.json()) as StreakStats)
    } catch {
      setStreak(null)
    } finally {
      setStreakLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadHistory()
    void loadSchedules()
    void loadMemory()
    void loadReferral()
    void loadStreak()
  }, [loadHistory, loadSchedules, loadMemory, loadReferral, loadStreak])

  async function copyReferralLink() {
    if (!referral) return
    const link = `${window.location.origin}/r/${referral.code}`
    try {
      await navigator.clipboard.writeText(link)
      setReferralCopied(true)
      setTimeout(() => setReferralCopied(false), 2000)
    } catch {
      setReferralError("Couldn't copy — try selecting the link manually")
    }
  }

  async function shareReferralLink() {
    if (!referral) return
    const link = `${window.location.origin}/r/${referral.code}`
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: "Join me on Yomi", url: link })
        return
      } catch {
        // user cancelled the share sheet, or share failed — fall through to copy
      }
    }
    await copyReferralLink()
  }

  const connectedCatalog = buildCatalog(connectedProviders).filter((c) => c.connected)
  const lastUserTurn = [...history].reverse().find((t) => t.role === "user")
  const enabledSchedules = schedules.filter((s) => s.enabled)
  const soonestNextRunAt = enabledSchedules
    .map((s) => s.nextRunAt)
    .filter((v): v is string => !!v)
    .sort()[0]
  const latestActivity = recentActivity[0]

  const referralLink = referral ? `${window.location.origin}/r/${referral.code}` : ""

  return (
    <div className="space-y-6">
      {!streakLoading && streak && (
        <div className="flex justify-end">
          <button
            onClick={() => onNavigate("streaks")}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
          >
            <Flame size={13} className="text-primary" />
            {streak.currentStreak > 0
              ? `${streak.currentStreak} day streak`
              : "Start a streak"}
          </button>
        </div>
      )}

      <TelegramCard
        platformLinks={platformLinks}
        platformsLoading={platformsLoading}
        unlinking={unlinkingPlatform}
        onUnlink={onUnlinkPlatform}
      />

      {!referralLoading && referral && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/[0.02] p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground mb-2">
                Referrals
              </p>
              <h2
                className="text-2xl font-light text-foreground"
                style={{ letterSpacing: "-0.02em" }}
              >
                Get 100 credits for every friend.
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Credits land as soon as they join Yomi through your link.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:min-w-[280px]">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2.5">
                <code className="flex-1 truncate pl-1 text-xs text-foreground">
                  {referralLink}
                </code>
                <button
                  onClick={copyReferralLink}
                  className="shrink-0 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {referralCopied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={shareReferralLink}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background/60 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
                >
                  <Share2 size={12} />
                  Share
                </button>
                <button
                  onClick={() => onNavigate("referrals")}
                  className="flex-1 rounded-lg border border-border bg-background/60 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40"
                >
                  Track referrals
                </button>
              </div>
              {referralError && <p className="text-xs text-destructive">{referralError}</p>}
              <p className="text-xs text-muted-foreground">
                {referral.count} of {referral.cap} used · {referral.creditsEarned} credits earned
              </p>
            </div>
          </div>
        </div>
      )}

      <PlanBanner plan={plan} onClick={() => onNavigate("billing")} />

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Crown size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-medium text-foreground">Plans &amp; credits</h2>
          </div>
          <button
            onClick={() => onNavigate("billing")}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {billingError && <p className="mb-3 text-xs text-destructive">{billingError}</p>}

        {(() => {
          const currentIndex = PLANS.findIndex((x) => x.key === currentPlanKey)
          const upgrades = PLANS.filter((_, i) => i > currentIndex)
          if (upgrades.length === 0) {
            return (
              <p className="text-sm text-muted-foreground">
                You&apos;re on our top plan — thanks for being a power user.
              </p>
            )
          }
          return (
            <div
              className={cn(
                "grid grid-cols-1 gap-2.5",
                upgrades.length > 1 ? "sm:grid-cols-2" : "sm:max-w-xs",
              )}
            >
              {upgrades.map((p) => {
                const Icon = p.icon
                return (
                  <div
                    key={p.key}
                    className="flex flex-col gap-2 rounded-xl border border-border bg-background/40 p-3.5"
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon size={13} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">{p.name}</span>
                    </div>
                    <span className="text-base font-light text-foreground">
                      {formatPlanPrice(p.priceUsd)}
                      <span className="text-[10px] text-muted-foreground">{p.priceSub}</span>
                    </span>
                    <button
                      onClick={() => onUpgrade(p.key)}
                      disabled={billingLoading !== null}
                      className="mt-0.5 flex items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {billingLoading === p.key ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Crown size={11} />
                      )}
                      Upgrade
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {currentPlanKey !== "explore" && creditPacks.length > 0 && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {creditPacks.map((pack) => (
              <button
                key={pack.key}
                onClick={() => onBuyCredits(pack.key)}
                disabled={creditLoading !== null}
                className="rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary/60 disabled:opacity-50"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Plus size={12} className="text-primary" />
                  {pack.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {creditLoading === pack.key ? "Starting..." : formatPackPrice(pack)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard
          icon={MessageSquare}
          title="History"
          loading={historyLoading}
          empty={history.length === 0}
          emptyText="No conversation yet"
          onClick={() => onNavigate("conversation")}
        >
          {lastUserTurn && <p>{truncate(lastUserTurn.content, 80)}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {history.length} message{history.length === 1 ? "" : "s"}
          </p>
        </StatCard>

        <StatCard
          icon={Clock}
          title="Schedules"
          loading={schedulesLoading}
          empty={schedules.length === 0}
          emptyText="No automations yet"
          onClick={() => onNavigate("schedules")}
        >
          <p>
            {enabledSchedules.length} of {schedules.length} active
          </p>
          {soonestNextRunAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next run {relativeFuture(soonestNextRunAt)}
            </p>
          )}
        </StatCard>

        <StatCard
          icon={Brain}
          title="Memory"
          loading={memoryLoading}
          empty={memory.length === 0}
          emptyText="Nothing remembered yet"
          onClick={() => onNavigate("memory")}
        >
          <p>
            {memory.length} memor{memory.length === 1 ? "y" : "ies"}
          </p>
        </StatCard>

        <StatCard
          icon={HeartPulse}
          title="Status"
          loading={false}
          empty={false}
          emptyText=""
          onClick={() => onNavigate("status")}
        >
          <p>Agent &amp; connector health</p>
        </StatCard>

        <StatCard
          icon={Flame}
          title="Streak"
          loading={streakLoading}
          empty={!streak || (streak.currentStreak === 0 && streak.totalMessagesSent === 0)}
          emptyText="Message Yomi to start one"
          onClick={() => onNavigate("streaks")}
        >
          {streak && (
            <>
              <p>{streak.currentStreak} day streak</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Longest: {streak.longestStreak}
              </p>
            </>
          )}
        </StatCard>

        <StatCard
          icon={Activity}
          title="Activity"
          loading={false}
          empty={!latestActivity}
          emptyText="No activity yet"
          onClick={() => onNavigate("billing")}
        >
          {latestActivity && (
            <>
              <p>{latestActivity.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {relativePast(latestActivity.createdAt)}
              </p>
            </>
          )}
        </StatCard>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Plug size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-medium text-foreground">
              Connections{" "}
              <span className="text-muted-foreground font-normal">({connectedCatalog.length})</span>
            </h2>
          </div>
          <button
            onClick={() => onNavigate("integrations")}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {connectedCatalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing connected yet. Link Gmail, Slack, Notion, GitHub and more from Connections.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {connectedCatalog.map((c) => (
              <button
                key={c.id}
                onClick={() => onNavigate("integrations")}
                className="flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-2.5 py-1.5 text-xs text-foreground transition-colors hover:border-primary/40"
              >
                <ConnectorIcon id={c.id} size={14} />
                {c.name}
              </button>
            ))}
          </div>
        )}

        {unhealthyCount > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-yellow-300">
            <AlertTriangle size={12} className="shrink-0" />
            {unhealthyCount} need{unhealthyCount === 1 ? "s" : ""} reconnecting
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Brain size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-medium text-foreground">Memory</h2>
          </div>
          <button
            onClick={() => onNavigate("memory")}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {memoryLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : memory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {memory.map((row) => (
              <li key={row.id} className="text-sm">
                {row.topic && <span className="font-medium text-foreground">{row.topic}: </span>}
                <span className="text-muted-foreground">
                  {truncate(row.summary || row.content, 100)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-center">
        <a
          href="https://github.com/arka6fx/yomi-feedback/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink size={12} />
          Send feedback
        </a>
      </div>
    </div>
  )
}
