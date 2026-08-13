"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Gift, Loader2 } from "lucide-react"

type ReferralEvent = {
  id: string
  creditsGranted: number
  createdAt: string
}

type ReferralStats = {
  code: string
  count: number
  cap: number
  creditsEarned: number
  events: ReferralEvent[]
}

function when(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ReferralsManager({ token }: { token: string }) {
  const [stats, setStats] = useState<ReferralStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/referrals/me", { headers: auth })
      if (!res.ok) throw new Error(`Couldn't load referrals (${res.status})`)
      const data = (await res.json()) as ReferralStats
      setStats(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load referrals")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function copyLink() {
    if (!stats) return
    const link = `${window.location.origin}/r/${stats.code}`
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 flex justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <p className="text-sm text-destructive">{error || "Couldn't load referrals"}</p>
      </div>
    )
  }

  const link = `${window.location.origin}/r/${stats.code}`

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
          <Gift size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="text-base font-medium text-foreground">Referrals</h2>
          <p className="text-sm text-muted-foreground">
            Get 100 credits for every friend who joins Yomi through your link.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-3">
        <code className="flex-1 truncate text-sm text-foreground">{link}</code>
        <button
          onClick={copyLink}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Referrals used</p>
          <p className="text-lg font-medium text-foreground">
            {stats.count} <span className="text-sm text-muted-foreground">/ {stats.cap}</span>
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Credits earned</p>
          <p className="text-lg font-medium text-foreground">{stats.creditsEarned}</p>
        </div>
      </div>

      {stats.events.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            History
          </p>
          <div className="space-y-1.5">
            {stats.events.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{when(e.createdAt)}</span>
                <span className="text-foreground">+{e.creditsGranted} credits</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
