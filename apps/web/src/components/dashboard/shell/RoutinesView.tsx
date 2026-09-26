"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  MessageCircle,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { TELEGRAM_BOT_URL } from "@/lib/site"
import { Skeleton } from "@/components/dashboard/shell/motion"
import { cn } from "@/lib/utils"

type Routine = {
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
  timezone?: string
  skillId?: string | null
}

type SkillInfo = { id: string; name: string; emoji: string }

const EXAMPLES = [
  "every day at 8am",
  "every weekday at 9am",
  "every monday at 10am",
  "every 2 hours",
  "30m",
]

function when(value?: string | null) {
  if (!value) return null
  const date = new Date(value)
  const today = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  if (date.toDateString() === today.toDateString()) return `today ${time}`
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (date.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function RoutinesView({
  token,
  onNavigate,
}: {
  token: string
  onNavigate: (tab: DashboardTab) => void
}) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [skills, setSkills] = useState<Record<string, SkillInfo>>({})
  const [canSchedule, setCanSchedule] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [schedule, setSchedule] = useState("every day at 8am")
  const [prompt, setPrompt] = useState("")
  const [saving, setSaving] = useState(false)

  const headers = useCallback(
    () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token],
  )

  const load = useCallback(async () => {
    setError("")
    try {
      const [routinesRes, skillsRes] = await Promise.all([
        fetch("/api/schedules", { headers: headers() }),
        fetch("/api/skills", { headers: headers() }),
      ])
      if (!routinesRes.ok) throw new Error("Couldn’t load your routines")
      setRoutines(((await routinesRes.json()) as { schedules?: Routine[] }).schedules ?? [])
      if (skillsRes.ok) {
        const data = (await skillsRes.json()) as { skills: SkillInfo[]; canSchedule: boolean }
        setSkills(Object.fromEntries(data.skills.map((s) => [s.id, s])))
        setCanSchedule(data.canSchedule)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t load your routines")
    } finally {
      setLoading(false)
    }
  }, [headers])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!creating) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setCreating(false)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [creating])

  async function create() {
    if (!schedule.trim() || !prompt.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          schedule: schedule.trim(),
          prompt: prompt.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) {
        if (data.code === "feature_not_available") setCanSchedule(false)
        throw new Error(data.error ?? "Couldn’t save that routine")
      }
      setPrompt("")
      setCreating(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save that routine")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(routine: Routine) {
    setBusy(routine.id)
    try {
      const res = await fetch(`/api/schedules/${routine.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ enabled: !routine.enabled }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch {
      setError("Couldn’t update that routine")
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/schedules/${id}`, { method: "DELETE", headers: headers() })
      if (!res.ok) throw new Error()
      setRoutines((current) => current.filter((r) => r.id !== id))
    } catch {
      setError("Couldn’t delete that routine")
    } finally {
      setBusy(null)
      setConfirmDelete(null)
    }
  }

  const card =
    "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"

  return (
    <div className="page-fade space-y-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">routines</h1>
          <p className="mt-3 text-sm text-muted-foreground">things yomi does for you on repeat.</p>
        </div>
        {canSchedule && routines.length > 0 && (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
          >
            <Plus size={15} /> new routine
          </button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!canSchedule && (
        <div className={cn(card, "flex flex-wrap items-center justify-between gap-3 p-5")}>
          <div>
            <p className="font-semibold">routines are part of Pro</p>
            <p className="text-sm text-muted-foreground">
              Pro runs up to 5 routines for you ($5/month). You can still try any skill in Telegram
              for free.
            </p>
          </div>
          <button
            onClick={() => onNavigate("billing")}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            see plans
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="loading routines">
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-[76px] rounded-[1.5rem]" />
          ))}
        </div>
      ) : routines.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-4xl font-bold tracking-tight">no routines yet.</p>
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            ask yomi to remind you, watch something, or send a daily recap. anything repeating shows
            up here.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <a
              href={TELEGRAM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_6px_18px_rgba(34,158,217,0.35)]"
              style={{ background: "linear-gradient(180deg, #37aee2 0%, #1e96c8 100%)" }}
            >
              <MessageCircle size={15} /> text yomi
            </a>
            {canSchedule && (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-1.5 rounded-full bg-card px-5 py-2.5 text-sm font-semibold shadow-sm hover:bg-muted"
              >
                <Plus size={15} /> new routine
              </button>
            )}
          </div>
          <button
            onClick={() => onNavigate("skills")}
            className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            or add a skill from the gallery <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {routines.map((routine, i) => {
            const skill = routine.skillId ? skills[routine.skillId] : undefined
            const failed = routine.lastRunStatus === "skipped" || routine.lastRunStatus === "failed"
            return (
              <li
                key={routine.id}
                style={{ "--i": Math.min(i, 11) } as React.CSSProperties}
                className={cn(card, "rise flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap")}
              >
                <span
                  className={cn(
                    "grid size-11 shrink-0 place-items-center rounded-2xl bg-muted text-xl",
                    !routine.enabled && "opacity-50",
                  )}
                  aria-hidden
                >
                  {skill?.emoji ?? <Zap size={18} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate font-semibold",
                      !routine.enabled && "text-muted-foreground",
                    )}
                  >
                    {skill?.name ?? routine.prompt}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {routine.schedule}
                    {routine.enabled && routine.nextRunAt
                      ? ` · next ${when(routine.nextRunAt)}`
                      : ""}
                    {!routine.enabled ? " · paused" : ""}
                    {routine.runCount ? ` · ran ${routine.runCount}×` : ""}
                  </p>
                  {failed && routine.lastRunError && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
                      <AlertCircle size={11} /> {routine.lastRunError}
                    </p>
                  )}
                  {routine.lastRunStatus === "queued" && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-500">
                      <Check size={11} /> last ran {when(routine.lastRunAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    role="switch"
                    aria-checked={routine.enabled}
                    aria-label={routine.enabled ? "Pause routine" : "Resume routine"}
                    onClick={() => void toggle(routine)}
                    disabled={busy === routine.id}
                    className={cn(
                      "relative h-7 w-12 rounded-full transition disabled:opacity-50",
                      routine.enabled ? "bg-[#2b8fff]" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-1 size-5 rounded-full bg-white shadow transition-all",
                        routine.enabled ? "left-6" : "left-1",
                      )}
                    />
                  </button>
                  {confirmDelete === routine.id ? (
                    <>
                      <button
                        onClick={() => void remove(routine.id)}
                        disabled={busy === routine.id}
                        className="rounded-full bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground"
                      >
                        delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold"
                      >
                        keep
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(routine.id)}
                      aria-label="Delete routine"
                      className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="New routine"
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setCreating(false)}
          />
          <div className="relative w-full max-w-lg rounded-t-[2rem] bg-card p-6 shadow-2xl sm:rounded-[2rem]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">new routine</h2>
              <button
                onClick={() => setCreating(false)}
                aria-label="Close"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
            <label className="mt-5 block">
              <span className="text-sm font-medium">when</span>
              <input
                value={schedule}
                onChange={(event) => setSchedule(event.target.value)}
                className="mt-1.5 w-full rounded-2xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2b8fff]"
              />
            </label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  onClick={() => setSchedule(example)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    schedule === example
                      ? "bg-foreground text-background"
                      : "bg-muted hover:bg-muted/70",
                  )}
                >
                  {example}
                </button>
              ))}
            </div>
            <label className="mt-5 block">
              <span className="text-sm font-medium">what should yomi do?</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                placeholder="Check my unread email and send me the three that need a reply."
                className="mt-1.5 w-full resize-none rounded-2xl bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#2b8fff]"
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Results arrive on Telegram within about 10 minutes of the time you pick.
            </p>
            <button
              onClick={() => void create()}
              disabled={saving || !schedule.trim() || !prompt.trim()}
              className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="mx-auto animate-spin" /> : "save routine"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
