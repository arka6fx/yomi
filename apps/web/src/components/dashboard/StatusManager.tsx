"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Plug,
  RefreshCw,
  WalletCards,
  XCircle,
} from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"
import { ListSkeleton } from "@/components/dashboard/shell/motion"

type CheckLevel = "ok" | "warn" | "down"
type Check = { id: string; label: string; level: CheckLevel; detail: string }

type StatusData = {
  overall: CheckLevel
  generatedAt: string
  plan: { plan: string; name: string; status: string; billingAccess: boolean }
  gateway: {
    running: boolean
    activeSessions: number
    adapters: { platform: string; connected: boolean }[]
  }
  telegram: { connected: boolean; linkedAt: string | null }
  connectors: { total: number; needsReconnect: { provider: string; displayName: string }[] }
  schedules: { total: number; enabled: number; nextRunAt: string | null }
  checks: Check[]
}

const LEVEL_META: Record<
  CheckLevel,
  { label: string; dot: string; text: string; Icon: typeof CheckCircle2 }
> = {
  ok: {
    label: "All systems healthy",
    dot: "bg-emerald-400",
    text: "text-emerald-400",
    Icon: CheckCircle2,
  },
  warn: {
    label: "Needs attention",
    dot: "bg-yellow-400",
    text: "text-yellow-400",
    Icon: AlertTriangle,
  },
  down: { label: "Action required", dot: "bg-red-400", text: "text-red-400", Icon: XCircle },
}

function when(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Cloud "Status" panel.
// of the gateway, plan/billing, Telegram, connectors, and schedules.
export function StatusManager({ token }: { token: string }) {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/status", { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Couldn't load status (${res.status})`)
      setData((await res.json()) as StatusData)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load status")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const overall = data ? LEVEL_META[data.overall] : LEVEL_META.ok

  return (
    <section className="space-y-6 pt-6">
      <PageHeader
        title="system status"
        subtitle={
          <span className="inline-flex items-center gap-2">
            {!loading && data && <span className={cn("h-1.5 w-1.5 rounded-full", overall.dot)} />}
            <span className={data ? overall.text : undefined}>
              {loading ? "checking…" : data ? overall.label : "status unavailable"}
            </span>
          </span>
        }
        actions={
          <>
            <button
              onClick={load}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </>
        }
      />
      <div className={cn(SURFACE, "p-5 sm:p-6")}>
        {error && <p className="mb-4 text-xs text-destructive">{error}</p>}

        {loading && !data ? (
          <ListSkeleton label="loading status" />
        ) : data ? (
          <div className="space-y-5">
            {/* Quick stat tiles */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile Icon={WalletCards} label="Chat" value="Unlimited" />
              <StatTile Icon={Plug} label="Connectors" value={String(data.connectors.total)} />
              <StatTile
                Icon={Clock}
                label="Schedules"
                value={`${data.schedules.enabled}/${data.schedules.total}`}
              />
              <StatTile Icon={Activity} label="Plan" value={data.plan.name} />
            </div>

            {/* Detailed checks */}
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {data.checks.map((ch) => {
                const meta = LEVEL_META[ch.level]
                const Icon = meta.Icon
                return (
                  <li
                    key={ch.id}
                    className="flex items-center justify-between gap-3 bg-background/40 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon size={16} className={cn("shrink-0", meta.text)} />
                      <span className="truncate text-sm text-foreground">{ch.label}</span>
                    </div>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {ch.detail}
                    </span>
                  </li>
                )
              })}
            </ul>

            {data.connectors.needsReconnect.length > 0 && (
              <div className="rounded-xl border border-yellow-500/25 bg-yellow-500/10 p-4">
                <p className="text-sm font-medium text-yellow-300">
                  Some connectors need reconnecting
                </p>
                <p className="mt-1 text-xs text-yellow-200/75">
                  {data.connectors.needsReconnect.map((c) => c.displayName).join(", ")} — reconnect
                  on the Integrations tab.
                </p>
              </div>
            )}

            {data.schedules.nextRunAt && (
              <p className="text-xs text-muted-foreground">
                Next scheduled task runs {when(data.schedules.nextRunAt)}.
              </p>
            )}

            <p className="text-[11px] text-muted-foreground/60">
              Last checked {when(data.generatedAt)}.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function StatTile({ Icon, label, value }: { Icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon size={13} className="shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className="truncate text-sm font-medium capitalize text-foreground">{value}</p>
    </div>
  )
}
