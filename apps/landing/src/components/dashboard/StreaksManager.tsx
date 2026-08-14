"use client"

import { useCallback, useEffect, useState } from "react"
import { Flame, Loader2, Trophy } from "lucide-react"

type StreakStats = {
  currentStreak: number
  longestStreak: number
  totalMessagesSent: number
  leaderboardOptIn: boolean
  leaderboardHandle: string | null
}

type LeaderboardEntry = {
  rank: number
  handle: string
  totalMessagesSent: number
  isYou: boolean
}

type Leaderboard = {
  entries: LeaderboardEntry[]
  yourRank: number | null
}

export function StreaksManager({ token }: { token: string }) {
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
      if (!leaderboardRes.ok) throw new Error(`Couldn't load leaderboard (${leaderboardRes.status})`)
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

  async function toggleOptIn() {
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
      await load()
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
          <div>
            <p className="text-sm text-foreground">Join the leaderboard</p>
            <p className="text-xs text-muted-foreground">
              {stats.leaderboardOptIn
                ? `Visible as "${stats.leaderboardHandle}" — anonymous, no real name shown.`
                : "Opt in to appear on the leaderboard below, anonymously."}
            </p>
          </div>
          <button
            onClick={toggleOptIn}
            disabled={toggling}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {stats.leaderboardOptIn ? "Opted in" : "Opt in"}
          </button>
        </div>
        {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Leaderboard</h3>
        </div>
        {leaderboard.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody&apos;s opted in yet.</p>
        ) : (
          <div className="space-y-1.5">
            {leaderboard.entries.map((entry) => (
              <div
                key={entry.rank}
                className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm ${
                  entry.isYou ? "bg-primary/10" : ""
                }`}
              >
                <span className="text-muted-foreground">
                  #{entry.rank} {entry.handle}
                  {entry.isYou && <span className="text-foreground"> (you)</span>}
                </span>
                <span className="text-foreground">{entry.totalMessagesSent}</span>
              </div>
            ))}
            {leaderboard.yourRank !== null && leaderboard.yourRank > leaderboard.entries.length && (
              <div className="flex items-center justify-between rounded-lg bg-primary/10 px-2 py-1.5 text-sm">
                <span className="text-muted-foreground">
                  #{leaderboard.yourRank} {stats.leaderboardHandle}
                  <span className="text-foreground"> (you)</span>
                </span>
                <span className="text-foreground">{stats.totalMessagesSent}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
