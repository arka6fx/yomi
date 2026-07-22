"use client"

import { useCallback, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { Activity, Brain, Clock, ExternalLink, Loader2, MessageSquare } from "lucide-react"
import type { DashboardTab } from "./SettingsMenu"

type ConversationTurn = { role: "user" | "assistant" | "system"; content: string }

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

type MemoryRow = {
  id: string
  topic?: string | null
  kind?: string | null
  scope?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

export type ActivityItem = {
  id: string
  label: string
  category: string
  credits: number
  createdAt: string
}

function truncate(text: string, max: number) {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed
}

function relativePast(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function relativeFuture(value: string) {
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60_000)
  if (minutes <= 0) return "any moment"
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `in ${hours}h`
  return `in ${Math.round(hours / 24)}d`
}

function StatCard({
  icon: Icon,
  title,
  loading,
  empty,
  emptyText,
  onClick,
  children,
}: {
  icon: typeof Clock
  title: string
  loading: boolean
  empty: boolean
  emptyText: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 sm:p-5 text-left transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <span className="text-xs font-medium uppercase tracking-widest">{title}</span>
      </div>
      {loading ? (
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
      ) : empty ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="text-sm text-foreground">{children}</div>
      )}
    </button>
  )
}

// Dashboard landing view: at-a-glance summary cards over data other tabs already
// fetch in full, plus a memory preview. Reuses existing endpoints only — no new backend.
export function DashboardHome({
  token,
  recentActivity,
  onNavigate,
}: {
  token: string
  recentActivity: ActivityItem[]
  onNavigate: (tab: DashboardTab) => void
}) {
  const [history, setHistory] = useState<ConversationTurn[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(true)
  const [memory, setMemory] = useState<MemoryRow[]>([])
  const [memoryLoading, setMemoryLoading] = useState(true)

  const auth = { Authorization: `Bearer ${token}` }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/conversation/shared", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { history?: ConversationTurn[] }
      setHistory((data.history ?? []).filter((t) => t.role !== "system"))
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [token])

  const loadSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    try {
      const res = await fetch("/api/schedules", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { schedules?: ScheduleRow[] }
      setSchedules(data.schedules ?? [])
    } catch {
      setSchedules([])
    } finally {
      setSchedulesLoading(false)
    }
  }, [token])

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true)
    try {
      const res = await fetch("/api/memory/entries?limit=5", { headers: auth })
      if (!res.ok) throw new Error("failed")
      const data = (await res.json()) as { memories?: MemoryRow[] }
      setMemory(data.memories ?? [])
    } catch {
      setMemory([])
    } finally {
      setMemoryLoading(false)
    }
  }, [token])

  useEffect(() => {
    void loadHistory()
    void loadSchedules()
    void loadMemory()
  }, [loadHistory, loadSchedules, loadMemory])

  const lastUserTurn = [...history].reverse().find((t) => t.role === "user")
  const enabledSchedules = schedules.filter((s) => s.enabled)
  const soonestNextRunAt = enabledSchedules
    .map((s) => s.nextRunAt)
    .filter((v): v is string => !!v)
    .sort()[0]
  const latestActivity = recentActivity[0]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          icon={MessageSquare}
          title="History"
          loading={historyLoading}
          empty={history.length === 0}
          emptyText="No conversation yet"
          onClick={() => onNavigate("conversation")}
        >
          {lastUserTurn && <p>{truncate(lastUserTurn.content, 80)}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {history.length} message{history.length === 1 ? "" : "s"}
          </p>
        </StatCard>

        <StatCard
          icon={Clock}
          title="Automations"
          loading={schedulesLoading}
          empty={schedules.length === 0}
          emptyText="No automations yet"
          onClick={() => onNavigate("schedules")}
        >
          <p>
            {enabledSchedules.length} of {schedules.length} active
          </p>
          {soonestNextRunAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next run {relativeFuture(soonestNextRunAt)}
            </p>
          )}
        </StatCard>

        <StatCard
          icon={Activity}
          title="Activity"
          loading={false}
          empty={!latestActivity}
          emptyText="No activity yet"
          onClick={() => onNavigate("billing")}
        >
          {latestActivity && (
            <>
              <p>{latestActivity.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {relativePast(latestActivity.createdAt)}
              </p>
            </>
          )}
        </StatCard>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10">
              <Brain size={16} className="text-primary" />
            </div>
            <h2 className="text-sm font-medium text-foreground">Memory</h2>
          </div>
          <button
            onClick={() => onNavigate("memory")}
            className="text-xs font-medium text-primary hover:underline"
          >
            View all
          </button>
        </div>

        {memoryLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : memory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing remembered yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {memory.map((row) => (
              <li key={row.id} className="text-sm">
                {row.topic && <span className="font-medium text-foreground">{row.topic}: </span>}
                <span className="text-muted-foreground">
                  {truncate(row.summary || row.content, 100)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-center">
        <a
          href="https://github.com/arka6fx/yomi/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink size={12} />
          Send feedback
        </a>
      </div>
    </div>
  )
}
