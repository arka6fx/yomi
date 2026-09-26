"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Clock, Loader2, MessageCircle, Plus, Search, X } from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { TELEGRAM_BOT_URL } from "@/lib/site"
import { Skeleton } from "@/components/dashboard/shell/motion"
import { cn } from "@/lib/utils"

type Skill = {
  id: string
  name: string
  emoji: string
  category: string
  kind: "routine" | "chat"
  description: string
  schedule: string | null
  worksWith: string[]
  added: boolean
  nextRunAt: string | null
}

const APP_NAMES: Record<string, string> = {
  google: "Gmail",
  "google-calendar": "Calendar",
  "google-classroom": "Classroom",
  github: "GitHub",
}

function tryLink(id: string) {
  return `${TELEGRAM_BOT_URL}?start=skill_${id}`
}

export function SkillsView({
  token,
  connectedProviders,
  onNavigate,
}: {
  token: string
  connectedProviders: string[]
  onNavigate: (tab: DashboardTab) => void
}) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [canSchedule, setCanSchedule] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")

  const call = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/skills${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      }),
    [token],
  )

  const load = useCallback(async () => {
    try {
      const res = await call("")
      if (!res.ok) throw new Error()
      const data = (await res.json()) as {
        skills: Skill[]
        categories: string[]
        canSchedule: boolean
      }
      setSkills(data.skills)
      setCategories(data.categories)
      setCanSchedule(data.canSchedule)
    } catch {
      setError("Couldn’t load skills")
    } finally {
      setLoading(false)
    }
  }, [call])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(skill: Skill) {
    setBusy(skill.id)
    setError("")
    try {
      const res = skill.added
        ? await call(`/${skill.id}`, { method: "DELETE" })
        : await call(`/${skill.id}`, {
            method: "POST",
            body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
          })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string; error?: string }
        throw new Error(body.detail ?? body.error ?? "Couldn’t update that skill")
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t update that skill")
    } finally {
      setBusy(null)
    }
  }

  const mine = skills.filter((skill) => skill.added)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return skills.filter(
      (skill) =>
        (category === "all" || skill.category === category) &&
        (!q || `${skill.name} ${skill.description} ${skill.category}`.toLowerCase().includes(q)),
    )
  }, [skills, query, category])

  const card =
    "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"
  const ghost =
    "rounded-full bg-muted px-3.5 py-1.5 text-xs font-semibold hover:bg-muted/70 disabled:opacity-50"

  const action = (skill: Skill) =>
    skill.kind === "routine" ? (
      skill.added ? (
        <button onClick={() => void toggle(skill)} disabled={busy === skill.id} className={ghost}>
          {busy === skill.id ? <Loader2 size={12} className="animate-spin" /> : "remove"}
        </button>
      ) : canSchedule ? (
        <button
          onClick={() => void toggle(skill)}
          disabled={busy === skill.id}
          className="inline-flex items-center gap-1 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
        >
          {busy === skill.id ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}{" "}
          add
        </button>
      ) : (
        <button onClick={() => onNavigate("billing")} className={ghost}>
          pro to schedule
        </button>
      )
    ) : null

  return (
    <div className="page-fade space-y-8 pt-6">
      <div>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">skills</h1>
        <p className="mt-3 max-w-xl text-sm text-muted-foreground">
          Ready-made things Yomi does for you. Routines run on a schedule and report on Telegram;
          the rest you just ask for. Try any of them in Telegram right now.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {mine.length > 0 && (
        <section aria-labelledby="my-skills" className="space-y-2">
          <h2 id="my-skills" className="text-xl font-bold tracking-tight">
            your skills
          </h2>
          {mine.map((skill) => (
            <div key={skill.id} className={cn(card, "flex flex-wrap items-center gap-3 p-4")}>
              <span
                className="grid size-11 place-items-center rounded-2xl bg-muted text-xl"
                aria-hidden
              >
                {skill.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{skill.name}</p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock size={11} /> {skill.schedule}
                  {skill.nextRunAt &&
                    ` · next ${new Date(skill.nextRunAt).toLocaleString(undefined, {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                    })}`}
                </p>
              </div>
              <a
                href={tryLink(skill.id)}
                target="_blank"
                rel="noopener noreferrer"
                className={ghost}
              >
                run now
              </a>
              {action(skill)}
            </div>
          ))}
        </section>
      )}

      <section aria-label="Browse skills" className="space-y-4">
        <label className={cn(card, "flex items-center gap-3 px-5 py-3.5")}>
          <Search size={16} className="text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="search skills"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted-foreground"
            >
              <X size={14} />
            </button>
          )}
        </label>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
          {["all", ...categories].map((name) => (
            <button
              key={name}
              onClick={() => setCategory(name)}
              aria-pressed={category === name}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                category === name
                  ? "bg-foreground text-background"
                  : "bg-card shadow-sm hover:bg-muted",
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {loading ? (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-label="loading skills"
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <Skeleton key={n} className="min-h-[190px] rounded-[1.75rem]" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">no skills match that</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((skill, i) => {
              const missing = skill.worksWith.filter((id) => !connectedProviders.includes(id))
              return (
                <article
                  key={skill.id}
                  style={{ "--i": Math.min(i, 11) } as React.CSSProperties}
                  className={cn(card, "rise flex flex-col p-5")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className="grid size-12 place-items-center rounded-2xl bg-muted text-2xl"
                      aria-hidden
                    >
                      {skill.emoji}
                    </span>
                    {skill.added ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-500">
                        <Check size={12} /> added
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                        {skill.kind === "routine" ? skill.schedule : "on demand"}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 text-lg font-bold tracking-tight">{skill.name}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {skill.description}
                  </p>
                  {skill.worksWith.length > 0 && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      works with {skill.worksWith.map((id) => APP_NAMES[id] ?? id).join(", ")}
                      {missing.length > 0 && (
                        <>
                          {" · "}
                          <button
                            onClick={() => onNavigate("integrations")}
                            className="font-semibold text-foreground underline-offset-2 hover:underline"
                          >
                            connect
                          </button>
                        </>
                      )}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <a
                      href={tryLink(skill.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-full bg-[#2b8fff] px-3.5 py-1.5 text-xs font-semibold text-white"
                    >
                      <MessageCircle size={12} /> try in telegram
                    </a>
                    {action(skill)}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
