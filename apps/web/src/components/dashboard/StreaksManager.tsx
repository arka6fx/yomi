"use client"

import { useCallback, useEffect, useState } from "react"
import { Crown, Cuboid, Flame, Loader2, Trophy, User } from "lucide-react"
import type { DashboardTab } from "./SettingsMenu"

type StreakStats = {
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
  leaderboardOptIn: boolean
  leaderboardHandle: string | null
  leaderboardShowPhoto: boolean
  avatarUrl: string | null
  plan: string
}

type LeaderboardEntry = {
  rank: number
  handle: string
  totalMessagesSent: number
  isYou: boolean
  avatarUrl: string | null
  plan: string
}

type Leaderboard = {
  entries: LeaderboardEntry[]
  yourRank: number | null
}

function Avatar({ url, size = 24 }: { url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (!url || broken) {
    return (
      <div
        style={{ width: size, height: size }}
        className="grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <User size={size * 0.6} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded-full object-cover"
    />
  )
}

const PLAN_BADGE: Record<string, { label: string; icon: typeof Crown; className: string }> = {
  pro: { label: "PRO", icon: Crown, className: "bg-primary/15 text-primary" },
  max: { label: "MAX", icon: Cuboid, className: "bg-violet-500/15 text-violet-400" },
}

function PlanBadge({ plan }: { plan: string }) {
  const badge = PLAN_BADGE[plan]
  if (!badge) return null
  const Icon = badge.icon
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
    >
      <Icon size={9} />
      {badge.label}
    </span>
  )
}

function RankMarker({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy size={16} className="shrink-0 text-yellow-400" />
  return <span className="w-4 shrink-0 text-right tabular-nums text-muted-foreground">{rank}</span>
}

function LeaderboardRow({
  rank,
  handle,
  plan,
  avatarUrl,
  totalMessagesSent,
  topScore,
  isYou,
}: {
  rank: number
  handle: string | null
  plan: string
  avatarUrl: string | null
  totalMessagesSent: number
  topScore: number
  isYou: boolean
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${isYou ? "bg-primary/10" : ""}`}
    >
      <RankMarker rank={rank} />
      <Avatar url={avatarUrl} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-foreground">{handle}</span>
          <PlanBadge plan={plan} />
          {isYou && <span className="shrink-0 text-xs text-muted-foreground">(you)</span>}
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(4, (totalMessagesSent / topScore) * 100)}%` }}
          />
        </div>
      </div>
      <span className="shrink-0 tabular-nums text-muted-foreground">{totalMessagesSent}</span>
    </div>
  )
}

export function StreaksManager({
  token,
  onNavigate,
}: {
  token: string
  onNavigate: (tab: DashboardTab) => void
}) {
  const [stats, setStats] = useState<StreakStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [actionError, setActionError] = useState("")
  const [toggling, setToggling] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [statsRes, leaderboardRes] = await Promise.all([
        fetch("/api/streaks/me", { headers: auth }),
        fetch("/api/streaks/leaderboard", { headers: auth }),
      ])
      if (!statsRes.ok) throw new Error(`Couldn't load streak stats (${statsRes.status})`)
      if (!leaderboardRes.ok)
        throw new Error(`Couldn't load leaderboard (${leaderboardRes.status})`)
      setStats((await statsRes.json()) as StreakStats)
      setLeaderboard((await leaderboardRes.json()) as Leaderboard)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load streaks")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleVisibility() {
    if (!stats || toggling) return
    setToggling(true)
    setActionError("")
    try {
      const res = await fetch("/api/streaks/opt-in", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: !stats.leaderboardOptIn }),
      })
      if (!res.ok) throw new Error(`Couldn't update leaderboard setting (${res.status})`)
      const result = (await res.json()) as { leaderboardOptIn: boolean }
      setStats((prev) => (prev ? { ...prev, leaderboardOptIn: result.leaderboardOptIn } : prev))
      const leaderboardRes = await fetch("/api/streaks/leaderboard", { headers: auth })
      if (leaderboardRes.ok) setLeaderboard((await leaderboardRes.json()) as Leaderboard)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't update leaderboard setting")
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats || !leaderboard) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load streaks"}</p>
      </div>
    )
  }

  const topScore = Math.max(
    1,
    leaderboard.entries[0]?.totalMessagesSent ?? 1,
    stats.totalMessagesSent,
  )
  const viewerInList = leaderboard.entries.some((e) => e.isYou)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Flame size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="text-base font-medium text-foreground">Streaks</h2>
            <p className="text-sm text-muted-foreground">
              Message Yomi every day to keep your streak alive.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Current streak</p>
            <p className="text-lg font-medium text-foreground">{stats.currentStreak}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Longest streak</p>
            <p className="text-lg font-medium text-foreground">{stats.longestStreak}</p>
          </div>
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Messages sent</p>
            <p className="text-lg font-medium text-foreground">{stats.totalMessagesSent}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-3">
            <Avatar url={stats.leaderboardShowPhoto ? stats.avatarUrl : null} size={32} />
            <div>
              <p className="text-sm text-foreground">
                {stats.leaderboardOptIn
                  ? "You're on the leaderboard"
                  : "You're hidden from the leaderboard"}
              </p>
              <p className="text-xs text-muted-foreground">
                {stats.leaderboardOptIn
                  ? `Visible as "${stats.leaderboardHandle}".`
                  : "Nobody can see you on the leaderboard right now."}
              </p>
            </div>
          </div>
          <button
            onClick={toggleVisibility}
            disabled={toggling}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
          >
            {toggling ? (
              <Loader2 size={14} className="animate-spin" />
            ) : stats.leaderboardOptIn ? (
              "Hide me"
            ) : (
              "Show me"
            )}
          </button>
        </div>
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}

        <button
          type="button"
          onClick={() => onNavigate("profile")}
          className="mt-3 text-xs font-medium text-primary hover:underline"
        >
          Edit profile →
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Leaderboard</h3>
        </div>
        {leaderboard.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody&apos;s here yet.</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.entries.map((entry) => (
              <LeaderboardRow
                key={entry.rank}
                rank={entry.rank}
                handle={entry.handle}
                plan={entry.plan}
                avatarUrl={entry.avatarUrl}
                totalMessagesSent={entry.totalMessagesSent}
                topScore={topScore}
                isYou={entry.isYou}
              />
            ))}
            {leaderboard.yourRank !== null && !viewerInList && (
              <LeaderboardRow
                rank={leaderboard.yourRank}
                handle={stats.leaderboardHandle}
                plan={stats.plan}
                avatarUrl={stats.leaderboardShowPhoto ? stats.avatarUrl : null}
                totalMessagesSent={stats.totalMessagesSent}
                topScore={topScore}
                isYou
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
