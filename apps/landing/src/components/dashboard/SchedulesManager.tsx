"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, Loader2, Pause, Play, Plus, Trash2, X } from "lucide-react"

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

const EXAMPLES = ["every day 9am", "every monday 9am", "every weekday 8am", "every 2h", "30m"]

function when(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

// Cloud schedules. Created here and run by the backend cron trigger, so they fire even
// when the desktop is closed. Results are delivered to Telegram.
export function SchedulesManager({ token }: { token: string }) {
  const [rows, setRows] = useState<ScheduleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [schedule, setSchedule] = useState("every day 9am")
  const [prompt, setPrompt] = useState("")
  const [saving, setSaving] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/schedules", { headers: auth })
      if (!res.ok) throw new Error(`Couldn't load schedules (${res.status})`)
      const data = (await res.json()) as { schedules?: ScheduleRow[] }
      setRows(data.schedules ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load schedules")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate() {
    if (!schedule.trim() || !prompt.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ schedule: schedule.trim(), prompt: prompt.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
      if (!res.ok) {
        if (data.code === "feature_not_available") setLocked(true)
        throw new Error(data.error ?? "Couldn't create schedule")
      }
      setPrompt("")
      setShowAdd(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create schedule")
    } finally {
      setSaving(false)
    }
  }

  async function toggle(row: ScheduleRow) {
    setBusy(row.id)
    try {
      await fetch(`/api/schedules/${row.id}`, {
        method: "PATCH",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !row.enabled }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    setBusy(id)
    try {
      await fetch(`/api/schedules/${id}`, { method: "DELETE", headers: auth })
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Clock size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              Scheduled <span className="italic">tasks</span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Yomi runs these on a schedule, even when your desktop is closed, and sends the result
              to your Telegram.
            </p>
          </div>
        </div>
        {!locked && (
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {showAdd ? <X size={12} /> : <Plus size={12} />}
            {showAdd ? "Cancel" : "New schedule"}
          </button>
        )}
      </div>

      {locked && (
        <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
          <p className="text-sm font-medium text-foreground">Scheduling is a Pro feature</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upgrade to Pro or Max to have Yomi run tasks for you on a schedule.
          </p>
          <a
            href="/dashboard?plan=pro"
            className="mt-3 inline-flex rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Upgrade
          </a>
        </div>
      )}

      {showAdd && !locked && (
        <div className="mb-5 rounded-xl border border-border bg-background/40 p-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">When</label>
          <input
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="every day 9am"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => setSchedule(ex)}
                className="rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {ex}
              </button>
            ))}
          </div>
          <label className="mb-1 mt-3 block text-xs font-medium text-muted-foreground">
            What should Yomi do?
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Summarize my unread email and send me the highlights."
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <button
            onClick={handleCreate}
            disabled={!schedule.trim() || !prompt.trim() || saving}
            className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            Create schedule
          </button>
        </div>
      )}

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading schedules…
        </div>
      ) : rows.length === 0 && !locked ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">No schedules yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            Create one above to have Yomi do recurring work for you, like a morning briefing.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                    {row.schedule}
                  </span>
                  {!row.enabled && (
                    <span className="text-[11px] text-muted-foreground">paused</span>
                  )}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-foreground">{row.prompt}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {row.enabled && row.nextRunAt ? `Next ${when(row.nextRunAt)}` : "Paused"}
                  {row.runCount ? ` · ${row.runCount} run${row.runCount === 1 ? "" : "s"}` : ""}
                  {row.lastRunStatus === "error" && row.lastRunError
                    ? ` · last run failed: ${row.lastRunError}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => toggle(row)}
                  disabled={busy === row.id}
                  aria-label={row.enabled ? "Pause" : "Resume"}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
                >
                  {busy === row.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : row.enabled ? (
                    <Pause size={14} />
                  ) : (
                    <Play size={14} />
                  )}
                </button>
                <button
                  onClick={() => remove(row.id)}
                  disabled={busy === row.id}
                  aria-label="Delete"
                  className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
