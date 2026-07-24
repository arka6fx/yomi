"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Clock,
  Cpu,
  Database,
  Loader2,
  Plug,
  RefreshCw,
  TrendingUp,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

type AnalyticsBucket = {
  key: string
  requests: number
  inputTokens: number
  outputTokens: number
  avgInputTokens: number
  avgOutputTokens: number
  avgLatencyMs: number
  estimatedCostUsd: number
}

type TopUser = AnalyticsBucket & {
  userId: string
  email: string | null
  name: string | null
}

type RevenueSummary = {
  mrrUsd: number
  planMix: { plan: string; count: number }[]
  subscriptionRevenueUsd: number
  creditPackRevenueUsd: number
  newSubscriptionsInPeriod: number
  trialToPaidRate: number | null
}

type AnalyticsResponse = {
  generatedAt: string
  period: { days: number; since: string; until: string }
  totals: {
    requests: number
    inputTokens: number
    outputTokens: number
    avgInputTokens: number
    avgOutputTokens: number
    avgLatencyMs: number
    estimatedCostUsd: number
  }
  revenue: RevenueSummary
  costPerEndpoint: AnalyticsBucket[]
  costPerModel: AnalyticsBucket[]
  costPerConnector: AnalyticsBucket[]
  dailySpend: AnalyticsBucket[]
  monthlySpend: AnalyticsBucket[]
  topUsers: TopUser[]
}

function dollars(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  })
}

function number(value: number) {
  return value.toLocaleString("en-US")
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function when(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function maxCost(rows: AnalyticsBucket[]) {
  return Math.max(...rows.map((row) => row.estimatedCostUsd), 0.000001)
}

export default function DeveloperDashboardPage() {
  const { data: session, isPending } = authClient.useSession()
  const router = useRouter()
  const [days, setDays] = useState(30)
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!isPending && !session) router.push("/signin")
  }, [session, isPending, router])

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/admin/cost-analytics?days=${days}`, {
        headers: { Authorization: `Bearer ${session.session.token}` },
      })
      const body = (await res.json()) as AnalyticsResponse | { error?: string }
      if (!res.ok)
        throw new Error(
          "error" in body && body.error ? body.error : `Analytics failed (${res.status})`,
        )
      setData(body as AnalyticsResponse)
    } catch (err) {
      setData(null)
      setError(err instanceof Error ? err.message : "Couldn't load analytics")
    } finally {
      setLoading(false)
    }
  }, [session, days])

  useEffect(() => {
    void load()
  }, [load])

  const dayMax = data ? maxCost(data.dailySpend) : 1

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/dashboard"
              className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft size={15} />
              Back to dashboard
            </Link>
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                <BarChart3 size={22} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Admin only
                </p>
                <h1 className="font-serif text-3xl leading-tight text-foreground sm:text-4xl">
                  AI cost <span className="italic">analytics</span>
                </h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Internal cost baseline before optimization. This uses usage telemetry only and never
              displays raw prompts or connector payloads.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2">
            {[7, 30, 90].map((option) => (
              <button
                key={option}
                onClick={() => setDays(option)}
                className={cn(
                  "rounded-xl px-3 py-2 text-xs font-medium transition-colors",
                  days === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option}d
              </button>
            ))}
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error === "Forbidden" ? "This page is only available to owner/admin accounts." : error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" />
            Loading cost analytics...
          </div>
        ) : data ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                icon={WalletCards}
                label="Estimated spend"
                value={dollars(data.totals.estimatedCostUsd)}
              />
              <MetricCard icon={Activity} label="Requests" value={number(data.totals.requests)} />
              <MetricCard
                icon={Database}
                label="Avg tokens"
                value={`${number(data.totals.avgInputTokens)} in / ${number(data.totals.avgOutputTokens)} out`}
              />
              <MetricCard
                icon={Clock}
                label="Avg latency"
                value={`${number(data.totals.avgLatencyMs)} ms`}
              />
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <TrendingUp size={16} className="text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Revenue &amp; billing
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard icon={WalletCards} label="MRR" value={dollars(data.revenue.mrrUsd)} />
                <MetricCard
                  icon={Activity}
                  label={`Revenue (${data.period.days}d)`}
                  value={dollars(
                    data.revenue.subscriptionRevenueUsd + data.revenue.creditPackRevenueUsd,
                  )}
                />
                <MetricCard
                  icon={Users}
                  label={`New subscriptions (${data.period.days}d)`}
                  value={number(data.revenue.newSubscriptionsInPeriod)}
                />
                <MetricCard
                  icon={TrendingUp}
                  label="Trial → paid"
                  value={
                    data.revenue.trialToPaidRate === null
                      ? "—"
                      : percent(data.revenue.trialToPaidRate)
                  }
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-background/40 p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Plan mix
                  </p>
                  <div className="space-y-2">
                    {data.revenue.planMix.map((row) => (
                      <div key={row.plan} className="flex items-center justify-between text-sm">
                        <span className="capitalize text-foreground">{row.plan}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {number(row.count)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background/40 p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Revenue split ({data.period.days}d)
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-foreground">Subscriptions</span>
                      <span className="tabular-nums text-muted-foreground">
                        {dollars(data.revenue.subscriptionRevenueUsd)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-foreground">Credit packs</span>
                      <span className="tabular-nums text-muted-foreground">
                        {dollars(data.revenue.creditPackRevenueUsd)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <AnalyticsTable
                title="Cost per endpoint"
                icon={Activity}
                rows={data.costPerEndpoint}
              />
              <AnalyticsTable title="Cost per model" icon={Cpu} rows={data.costPerModel} />
              <AnalyticsTable title="Cost per connector" icon={Plug} rows={data.costPerConnector} />
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                    Daily AI spend
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Generated {when(data.generatedAt)}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {when(data.period.since)} to {when(data.period.until)}
                </span>
              </div>
              <div className="space-y-2">
                {data.dailySpend.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No usage in this period.</p>
                ) : (
                  data.dailySpend.map((row) => (
                    <div
                      key={row.key}
                      className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3 text-sm"
                    >
                      <span className="text-muted-foreground">{row.key.slice(5)}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${Math.max(2, (row.estimatedCostUsd / dayMax) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-right tabular-nums text-foreground">
                        {dollars(row.estimatedCostUsd)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-4 flex items-center gap-2">
                <Users size={16} className="text-muted-foreground" />
                <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  Top 10 most expensive users
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">User</th>
                      <th className="py-2 pr-4 font-medium">Requests</th>
                      <th className="py-2 pr-4 font-medium">Cost</th>
                      <th className="py-2 pr-4 font-medium">Input</th>
                      <th className="py-2 pr-4 font-medium">Output</th>
                      <th className="py-2 pr-4 font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.topUsers.map((row) => (
                      <tr key={row.userId}>
                        <td className="py-3 pr-4">
                          <p className="font-medium text-foreground">
                            {row.email ?? row.name ?? row.userId}
                          </p>
                          <p className="text-xs text-muted-foreground">{row.userId}</p>
                        </td>
                        <td className="py-3 pr-4 tabular-nums">{number(row.requests)}</td>
                        <td className="py-3 pr-4 tabular-nums">{dollars(row.estimatedCostUsd)}</td>
                        <td className="py-3 pr-4 tabular-nums">{number(row.avgInputTokens)}</td>
                        <td className="py-3 pr-4 tabular-nums">{number(row.avgOutputTokens)}</td>
                        <td className="py-3 pr-4 tabular-nums">{number(row.avgLatencyMs)} ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        <Icon size={15} />
        {label}
      </div>
      <p className="text-2xl font-light text-foreground tabular-nums">{value}</p>
    </div>
  )
}

function AnalyticsTable({
  title,
  icon: Icon,
  rows,
}: {
  title: string
  icon: LucideIcon
  rows: AnalyticsBucket[]
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={16} className="text-muted-foreground" />
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {title}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Requests</th>
              <th className="py-2 pr-4 font-medium">Cost</th>
              <th className="py-2 pr-4 font-medium">Avg tokens</th>
              <th className="py-2 pr-4 font-medium">Latency</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.slice(0, 10).map((row) => (
              <tr key={row.key}>
                <td className="py-3 pr-4 font-medium text-foreground">{row.key}</td>
                <td className="py-3 pr-4 tabular-nums">{number(row.requests)}</td>
                <td className="py-3 pr-4 tabular-nums">{dollars(row.estimatedCostUsd)}</td>
                <td className="py-3 pr-4 tabular-nums">
                  {number(row.avgInputTokens)} / {number(row.avgOutputTokens)}
                </td>
                <td className="py-3 pr-4 tabular-nums">{number(row.avgLatencyMs)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
