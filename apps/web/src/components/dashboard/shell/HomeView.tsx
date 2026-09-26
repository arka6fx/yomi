"use client"

import { useEffect, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Brain,
  Check,
  Compass,
  Flame,
  Gift,
  Mail,
  MessageCircle,
  Plus,
  Wallet,
  Zap,
} from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { Reveal, Skeleton } from "@/components/dashboard/shell/motion"
import { TELEGRAM_BOT_URL } from "@/lib/site"
import { cn } from "@/lib/utils"

type Geo = { city: string | null; weather: { tempC: number; code: number } | null }
type Schedule = { enabled: boolean; nextRunAt?: string | null; prompt: string }
type InboxEmail = { unread: boolean }
type Payments = {
  monthTotals: Record<string, number>
  receipts?: { amount: number; currency: string; date: string }[]
}
type HomeCharacter = {
  id: string
  name: string
  emoji: string
  color: string
  tagline: string
  imageUrl: string
}
type Characters = { mine: HomeCharacter[]; saved: HomeCharacter[]; active: HomeCharacter | null }
type HomeSkill = {
  id: string
  name: string
  emoji: string
  description: string
  added: boolean
}
type Referral = { code: string; count: number; proDaysPerInvite: number }

type HomeData = {
  geo: Geo | null
  streak: number | null
  schedules: Schedule[] | null
  approvals: number | null
  memories: number | null
  emails: InboxEmail[] | null
  vaultItems: number | null
  payments: Payments | null
  characters: Characters | null
  skills: HomeSkill[] | null
  referral: Referral | null
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
  characters: null,
  skills: null,
  referral: null,
}

const HIDE_SETUP_KEY = "yomi.home.hideSetup"
const CARD =
  "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"
const DASHED =
  "grid place-items-center rounded-[1.5rem] border-2 border-dashed border-foreground/15 text-sm font-semibold text-foreground/70 transition hover:border-[#2b8fff]/50 hover:text-foreground"

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
  unhealthyCount = 0,
  onNavigate,
}: {
  token: string
  userName?: string | null
  connectedCount: number
  telegramLinked: boolean
  unhealthyCount?: number
  onNavigate: (tab: DashboardTab) => void
}) {
  const [data, setData] = useState<HomeData>(EMPTY)
  const [now, setNow] = useState<Date | null>(null)
  const [hideSetup, setHideSetup] = useState(false)
  const [copied, setCopied] = useState(false)

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
    void getJson<Characters>("/api/characters", token).then((characters) => patch({ characters }))
    void getJson<{ skills?: HomeSkill[] }>("/api/skills", token).then((r) =>
      patch({ skills: r?.skills ?? null }),
    )
    void getJson<Referral>("/api/referrals/me", token).then((referral) => patch({ referral }))
  }, [token])

  function hide() {
    setHideSetup(true)
    try {
      localStorage.setItem(HIDE_SETUP_KEY, "1")
    } catch {
      // fine: it just reappears next visit
    }
  }

  function unhide() {
    setHideSetup(false)
    try {
      localStorage.removeItem(HIDE_SETUP_KEY)
    } catch {
      // storage unavailable: it's shown for this visit anyway
    }
  }

  async function copyInvite() {
    if (!data.referral) return
    const link = `${window.location.origin}/r/${data.referral.code}`
    try {
      if (navigator.share) await navigator.share({ title: "yomi", url: link })
      else await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // the share sheet was dismissed
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

  const characters = [...(data.characters?.mine ?? []), ...(data.characters?.saved ?? [])]
  const active = data.characters?.active ?? null
  const mySkills = (data.skills ?? []).filter((s) => s.added)
  // Nothing added yet: suggest a couple instead of an empty row.
  const shownSkills = mySkills.length ? mySkills.slice(0, 3) : (data.skills ?? []).slice(0, 2)

  return (
    <div className="space-y-8">
      <Reveal i={0} className="flex flex-wrap items-end justify-between gap-3 pt-6">
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
      </Reveal>

      {unhealthyCount > 0 && (
        <button
          onClick={() => onNavigate("integrations")}
          className={cn(CARD, "flex w-full items-center gap-2 p-4 text-left text-sm font-medium")}
        >
          <AlertTriangle size={15} className="shrink-0 text-amber-500" />
          {unhealthyCount} connected app{unhealthyCount === 1 ? " needs" : "s need"} reconnecting
          <ArrowRight size={14} className="ml-auto text-muted-foreground" />
        </button>
      )}

      {hideSetup && doneCount < steps.length && (
        <button
          onClick={unhide}
          className="-mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground/60 hover:text-foreground"
        >
          <Check size={13} /> show setup · {doneCount} of {steps.length}
        </button>
      )}

      {!hideSetup && doneCount < steps.length && (
        <Reveal i={1}>
          <section className={cn(CARD, "p-6")} aria-labelledby="setup-heading">
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
              aria-label="setup progress"
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
                    onClick={() =>
                      step.tab === "home"
                        ? document
                            .getElementById("link-telegram")
                            ?.scrollIntoView({ behavior: "smooth" })
                        : onNavigate(step.tab)
                    }
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
        </Reveal>
      )}

      <Reveal i={2}>
        <section
          aria-label="who yomi is right now"
          className={cn(CARD, "flex items-center gap-4 p-5")}
        >
          {active ? (
            <Portrait character={active} className="size-14 rounded-2xl" />
          ) : (
            <img src="/brand-mark-128.png" alt="" className="size-14 rounded-2xl" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground">who yomi is right now</p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold">{active ? active.name : "yomi"}</h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                  telegramLinked ? "bg-sky-500/10 text-sky-600" : "bg-muted text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    telegramLinked ? "bg-sky-500" : "bg-muted-foreground",
                  )}
                />
                {telegramLinked ? "on telegram" : "telegram not linked"}
              </span>
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {active
                ? "they answer your texts. say “back to yomi” any time."
                : "the usual yomi. tap a character below to switch who answers your texts."}
            </p>
          </div>
        </section>
      </Reveal>

      <Row
        i={3}
        title="your characters"
        action={{ label: "discover", icon: Compass, onClick: () => onNavigate("characters") }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {data.characters === null &&
            [0, 1, 2].map((n) => <Skeleton key={n} className="min-h-[220px]" />)}
          {characters.slice(0, 4).map((c, idx) => (
            <button
              key={c.id}
              onClick={() => onNavigate("characters")}
              style={{ "--i": idx } as React.CSSProperties}
              className={cn(
                CARD,
                "rise overflow-hidden text-left transition hover:-translate-y-0.5",
              )}
            >
              <Portrait character={c} className="aspect-[4/5] w-full" />
              <div className="p-3">
                <p className="truncate text-sm font-bold">{c.name}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{c.tagline}</p>
              </div>
            </button>
          ))}
          <button onClick={() => onNavigate("characters")} className={cn(DASHED, "min-h-[220px]")}>
            <span className="flex flex-col items-center gap-2">
              <span className="grid size-10 place-items-center rounded-full bg-card shadow-sm">
                <Plus size={16} />
              </span>
              {characters.length ? "make one" : "pick a character"}
            </span>
          </button>
        </div>
      </Row>

      <Row
        i={4}
        title={mySkills.length ? "your skills" : "try a skill"}
        action={{ label: "browse all", icon: ArrowRight, onClick: () => onNavigate("skills") }}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.skills === null &&
            [0, 1].map((n) => <Skeleton key={n} className="min-h-[92px] rounded-[1.75rem]" />)}
          {shownSkills.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => onNavigate("skills")}
              style={{ "--i": idx } as React.CSSProperties}
              className={cn(CARD, "rise flex items-start gap-3 p-4 text-left")}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-muted text-xl">
                {s.emoji}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{s.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{s.description}</span>
                <span
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 text-xs font-semibold",
                    s.added ? "text-[#2b8fff]" : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      s.added ? "bg-[#2b8fff]" : "bg-muted-foreground",
                    )}
                  />
                  {s.added ? "on" : "not added"}
                </span>
              </span>
            </button>
          ))}
          <button onClick={() => onNavigate("skills")} className={cn(DASHED, "min-h-[92px]")}>
            <span className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-full bg-card shadow-sm">
                <Plus size={14} />
              </span>
              add a skill
            </span>
          </button>
        </div>
      </Row>

      <Row i={5} title="today">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          <Tile icon={Brain} title="memory" onClick={() => onNavigate("memory")}>
            <Big>{data.memories ?? "–"}</Big>
            <Small>{data.memories === 1 ? "thing yomi knows" : "things yomi knows"}</Small>
          </Tile>
          <Tile icon={Gift} title="invite a friend" onClick={() => void copyInvite()}>
            <span className="block text-sm font-bold leading-snug">
              {data.referral
                ? `${data.referral.proDaysPerInvite} days of pro for you both`
                : "share yomi with a friend"}
            </span>
            <Small>
              {copied
                ? "link copied"
                : data.referral?.count
                  ? `${data.referral.count} joined so far`
                  : "nobody yet, be the first"}
            </Small>
          </Tile>
          <div className="flex min-h-[140px] flex-col rounded-[1.5rem] bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]">
            <span className="flex items-center gap-2 text-sm font-medium">
              <span className="grid size-7 place-items-center rounded-lg bg-muted">
                <MessageCircle size={14} />
              </span>
              say hi
            </span>
            <span className="mt-2 text-xs text-muted-foreground">
              {active
                ? `${active.name} is waiting on telegram.`
                : "text yomi anything on telegram."}
            </span>
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto inline-flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_rgba(34,158,217,0.3)]"
              style={{ background: "linear-gradient(180deg, #37aee2 0%, #1e96c8 100%)" }}
            >
              <MessageCircle size={12} /> text yomi
            </a>
          </div>
          {(data.approvals ?? 0) > 0 && (
            <Tile icon={BadgeCheck} title="approvals" onClick={() => onNavigate("approvals")}>
              <Big>{data.approvals}</Big>
              <Small>waiting for your ok</Small>
            </Tile>
          )}
          {unread > 0 && (
            <Tile icon={Mail} title="inbox" onClick={() => onNavigate("email")}>
              <Big>{unread}</Big>
              <Small>{unread === 1 ? "unread email" : "unread emails"}</Small>
            </Tile>
          )}
          {spent.length > 0 && (
            <Tile icon={Wallet} title="spent this month" onClick={() => onNavigate("vault")}>
              <Big>{spent.map(([c, a]) => money(a, c)).join(" · ")}</Big>
              <Small>cards and receipts</Small>
            </Tile>
          )}
        </div>
      </Row>
    </div>
  )
}

function Portrait({ character, className }: { character: HomeCharacter; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (character.imageUrl && !broken) {
    return (
      <img
        src={character.imageUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className={cn("shrink-0 bg-muted object-cover object-top", className)}
      />
    )
  }
  return (
    <span
      style={{ background: `${character.color}22` }}
      className={cn("grid shrink-0 place-items-center text-4xl", className)}
      aria-hidden
    >
      {character.emoji || character.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function Row({
  i = 0,
  title,
  action,
  children,
}: {
  i?: number
  title: string
  action?: { label: string; icon: typeof Zap; onClick: () => void }
  children: React.ReactNode
}) {
  return (
    <Reveal i={i}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        {action && (
          <button
            onClick={action.onClick}
            className="inline-flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            {action.icon === ArrowRight ? null : <action.icon size={13} />}
            {action.label}
            <ArrowRight size={13} />
          </button>
        )}
      </div>
      {children}
    </Reveal>
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
