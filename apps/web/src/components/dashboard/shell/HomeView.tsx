"use client"

import { useEffect, useState } from "react"
import { Activity, BadgeCheck, Brain, Check, Flame, Mail, Wallet, Zap } from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { cn } from "@/lib/utils"

type Geo = { city: string | null; weather: { tempC: number; code: number } | null }
type Schedule = { enabled: boolean; nextRunAt?: string | null; prompt: string }
type InboxEmail = { unread: boolean }
type Payments = {
  monthTotals: Record<string, number>
  receipts?: { amount: number; currency: string; date: string }[]
}

type HomeData = {
  geo: Geo | null
  streak: number | null
  schedules: Schedule[] | null
  approvals: number | null
  memories: number | null
  emails: InboxEmail[] | null
  vaultItems: number | null
  payments: Payments | null
}

const EMPTY: HomeData = {
  geo: null,
  streak: null,
  schedules: null,
  approvals: null,
  memories: null,
  emails: null,
  vaultItems: null,
  payments: null,
}

const HIDE_SETUP_KEY = "yomi.home.hideSetup"

function greeting(hour: number) {
  if (hour < 5) return "still up?"
  if (hour < 12) return "good morning."
  if (hour < 17) return "good afternoon."
  if (hour < 22) return "good evening."
  return "good night."
}

// WMO weather interpretation codes, grouped.
function weatherIcon(code: number) {
  if (code === 0) return "☀️"
  if (code <= 3) return "⛅"
  if (code <= 48) return "🌫️"
  if (code <= 67 || (code >= 80 && code <= 82)) return "🌧️"
  if (code <= 77 || code === 85 || code === 86) return "❄️"
  return "⛈️"
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${Math.round(amount)} ${currency}`
  }
}

function relative(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (date.toDateString() === today.toDateString()) return `today ${time}`
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
}

async function getJson<T>(url: string, token?: string): Promise<T | null> {
  try {
    const res = await fetch(
      url,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    )
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

export function HomeView({
  token,
  userName,
  connectedCount,
  telegramLinked,
  onNavigate,
}: {
  token: string
  userName?: string | null
  connectedCount: number
  telegramLinked: boolean
  onNavigate: (tab: DashboardTab) => void
}) {
  const [data, setData] = useState<HomeData>(EMPTY)
  const [now, setNow] = useState<Date | null>(null)
  const [hideSetup, setHideSetup] = useState(false)

  useEffect(() => {
    setNow(new Date())
    try {
      setHideSetup(localStorage.getItem(HIDE_SETUP_KEY) === "1")
    } catch {
      // storage can be unavailable (private mode); show the card
    }
    const patch = (part: Partial<HomeData>) => setData((current) => ({ ...current, ...part }))
    void getJson<Geo>("/api/geo").then((geo) => patch({ geo }))
    void getJson<{ currentStreak?: number }>("/api/streaks/me", token).then((r) =>
      patch({ streak: r?.currentStreak ?? null }),
    )
    void getJson<{ schedules?: Schedule[] }>("/api/schedules", token).then((r) =>
      patch({ schedules: r?.schedules ?? null }),
    )
    void getJson<{ actions?: unknown[] }>("/api/actions/pending", token).then((r) =>
      patch({ approvals: r?.actions?.length ?? null }),
    )
    void getJson<{ memories?: unknown[] }>("/api/memory/entries?limit=200", token).then((r) =>
      patch({ memories: r?.memories?.length ?? null }),
    )
    void getJson<{ emails?: InboxEmail[] }>("/api/email", token).then((r) =>
      patch({ emails: r?.emails ?? null }),
    )
    void getJson<{ items?: unknown[] }>("/api/vault/items", token).then((r) =>
      patch({ vaultItems: r?.items?.length ?? null }),
    )
    void getJson<Payments>("/api/vault/payments", token).then((payments) => patch({ payments }))
  }, [token])

  function hide() {
    setHideSetup(true)
    try {
      localStorage.setItem(HIDE_SETUP_KEY, "1")
    } catch {
      // fine: it just reappears next visit
    }
  }

  const steps = [
    { label: "link telegram", done: telegramLinked, tab: "home" as DashboardTab },
    { label: "connect your apps", done: connectedCount > 0, tab: "integrations" as DashboardTab },
    {
      label: "set up a routine",
      hint: "yomi works while you sleep",
      done: (data.schedules?.length ?? 0) > 0,
      tab: "schedules" as DashboardTab,
    },
    {
      label: "save something to your vault",
      done: (data.vaultItems ?? 0) > 0,
      tab: "vault" as DashboardTab,
    },
    {
      label: "try your yomi email",
      hint: "forward a receipt to it",
      done: (data.emails?.length ?? 0) > 0,
      tab: "email" as DashboardTab,
    },
  ]
  const doneCount = steps.filter((step) => step.done).length

  const nextRoutine = (data.schedules ?? [])
    .filter((s) => s.enabled && s.nextRunAt)
    .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)))[0]
  const unread = (data.emails ?? []).filter((e) => e.unread).length
  const spent = Object.entries(data.payments?.monthTotals ?? {})
  for (const receipt of data.payments?.receipts ?? []) {
    if (!receipt.date.startsWith(new Date().toISOString().slice(0, 7))) continue
    const entry = spent.find(([currency]) => currency === receipt.currency)
    if (entry) entry[1] += receipt.amount
    else spent.push([receipt.currency, receipt.amount])
  }

  const card =
    "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-6">
        <div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
            {now ? greeting(now.getHours()) : "hello."}
          </h1>
          <p className="mt-2 text-sm font-medium text-foreground/60">
            {now
              ?.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
              .toLowerCase()}
            {data.geo?.weather && (
              <>
                {" · "}
                {weatherIcon(data.geo.weather.code)} {data.geo.weather.tempC}°C
                {data.geo.city ? ` ${data.geo.city.toLowerCase()}` : ""}
              </>
            )}
            {userName ? ` · hi ${(userName.split(" ")[0] ?? userName).toLowerCase()}` : ""}
          </p>
        </div>
        {data.streak !== null && (
          <button
            onClick={() => onNavigate("streaks")}
            className="flex items-center gap-1.5 rounded-full bg-card px-3.5 py-1.5 text-sm font-semibold shadow-sm"
          >
            <Flame size={14} className="text-orange-500" /> {data.streak} day streak
          </button>
        )}
      </div>

      {!hideSetup && doneCount < steps.length && (
        <section className={cn(card, "p-6")} aria-labelledby="setup-heading">
          <div className="flex items-center justify-between">
            <h2 id="setup-heading" className="text-sm font-semibold">
              set up yomi
            </h2>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {doneCount} of {steps.length}
              <button onClick={hide} className="hover:text-foreground">
                hide
              </button>
            </div>
          </div>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={steps.length}
          >
            <div
              className="h-full rounded-full bg-[#2b8fff] transition-all"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </div>
          <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {steps.map((step) => (
              <li key={step.label}>
                <button
                  onClick={() => onNavigate(step.tab)}
                  className="flex items-start gap-2.5 text-left"
                >
                  <span
                    className={cn(
                      "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                      step.done
                        ? "border-[#2b8fff] bg-[#2b8fff] text-white"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {step.done && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span>
                    <span
                      className={cn(
                        "block text-sm",
                        step.done
                          ? "text-muted-foreground line-through"
                          : "font-medium text-foreground",
                      )}
                    >
                      {step.label}
                    </span>
                    {!step.done && step.hint && (
                      <span className="block text-xs text-muted-foreground">{step.hint}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-3 text-xl font-bold tracking-tight">
          today
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Tile icon={Zap} title="routines" onClick={() => onNavigate("schedules")}>
            {nextRoutine?.nextRunAt ? (
              <>
                <Big>{relative(nextRoutine.nextRunAt)}</Big>
                <Small>{nextRoutine.prompt}</Small>
              </>
            ) : (
              <>
                <Small>nothing scheduled</Small>
                <Small>try “brief me every day at 8am”</Small>
              </>
            )}
          </Tile>
          <Tile icon={BadgeCheck} title="approvals" onClick={() => onNavigate("approvals")}>
            <Big>{data.approvals ?? "–"}</Big>
            <Small>{data.approvals ? "waiting for your ok" : "nothing waiting"}</Small>
          </Tile>
          <Tile icon={Brain} title="memory" onClick={() => onNavigate("memory")}>
            <Big>{data.memories ?? "–"}</Big>
            <Small>{data.memories === 1 ? "thing yomi knows" : "things yomi knows"}</Small>
          </Tile>
          <Tile icon={Mail} title="inbox" onClick={() => onNavigate("email")}>
            <Big>{unread}</Big>
            <Small>{unread === 1 ? "unread email" : "unread emails"}</Small>
          </Tile>
          <Tile icon={Wallet} title="spent this month" onClick={() => onNavigate("vault")}>
            <Big>{spent.length ? spent.map(([c, a]) => money(a, c)).join(" · ") : "–"}</Big>
            <Small>cards and receipts</Small>
          </Tile>
          <Tile icon={Activity} title="activity" onClick={() => onNavigate("activity")}>
            <Small>see what yomi did for you</Small>
          </Tile>
        </div>
      </section>
    </div>
  )
}

function Tile({
  icon: Icon,
  title,
  onClick,
  children,
}: {
  icon: typeof Zap
  title: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[140px] flex-col rounded-[1.5rem] bg-card p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)] transition hover:-translate-y-0.5"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className="grid size-7 place-items-center rounded-lg bg-muted">
          <Icon size={14} />
        </span>
        {title}
      </span>
      <span className="mt-auto space-y-0.5 pt-4">{children}</span>
    </button>
  )
}

function Big({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-xl font-bold leading-tight tracking-tight sm:text-2xl">
      {children}
    </span>
  )
}

function Small({ children }: { children: React.ReactNode }) {
  return <span className="block truncate text-xs text-muted-foreground">{children}</span>
}
