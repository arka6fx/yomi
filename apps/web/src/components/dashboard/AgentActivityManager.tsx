"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, ChevronDown, Clock3, Loader2, RefreshCw, XCircle } from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"

type Run = {
  id: string
  platform?: string
  kind?: string
  status?: string
  plan?: string
  summary?: string | null
  error?: string | null
  attempts?: number
  durationSeconds?: number | null
  createdAt?: string
  completedAt?: string | null
}

type RunStep = { index?: number; tool?: string | null; status?: string; createdAt?: string }

export function AgentActivityManager({ token }: { token: string }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [steps, setSteps] = useState<Record<string, RunStep[]>>({})
  const [stepLoading, setStepLoading] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/agent/runs?limit=50", {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = response.ok ? ((await response.json()) as { runs?: Run[] }) : { runs: [] }
      setRuns(data.runs ?? [])
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleRun(runId: string) {
    if (openId === runId) {
      setOpenId(null)
      return
    }
    setOpenId(runId)
    if (steps[runId]) return
    setStepLoading(runId)
    try {
      const response = await fetch(`/api/agent/runs/${runId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = response.ok ? ((await response.json()) as { steps?: RunStep[] }) : { steps: [] }
      setSteps((current) => ({ ...current, [runId]: data.steps ?? [] }))
    } finally {
      setStepLoading(null)
    }
  }

  return (
    <section className="space-y-6 pt-6">
      <PageHeader
        title="activity"
        subtitle="a redacted record of what yomi ran, what it’s waiting for, and what needs your attention."
        actions={
          <>
            <button
              onClick={() => void load()}
              disabled={loading}
              aria-label="Refresh"
              className="grid size-10 place-items-center rounded-full bg-card shadow-sm hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
          </>
        }
      />
      <div className={cn(SURFACE, "p-5 sm:p-6")}>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={15} className="animate-spin" /> Loading activity…
          </div>
        ) : runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No agent runs yet. Your first Telegram task will appear here.
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                open={openId === run.id}
                steps={steps[run.id] ?? []}
                loading={stepLoading === run.id}
                onToggle={() => void toggleRun(run.id)}
              />
            ))}
          </div>
        )}
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
          Secrets, credentials, raw prompts, and tool payloads are intentionally excluded from this
          view.
        </p>
      </div>
    </section>
  )
}

function RunRow({
  run,
  open,
  steps,
  loading,
  onToggle,
}: {
  run: Run
  open: boolean
  steps: RunStep[]
  loading: boolean
  onToggle: () => void
}) {
  const status = run.status ?? "unknown"
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "failed"
        ? XCircle
        : status === "running"
          ? Loader2
          : Clock3
  const tone =
    status === "completed"
      ? "text-emerald-400"
      : status === "failed"
        ? "text-destructive"
        : "text-amber-300"
  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <button onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        <Icon
          size={16}
          className={`mt-0.5 shrink-0 ${tone} ${status === "running" ? "animate-spin" : ""}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium capitalize text-foreground">
              {run.kind ?? "agent task"}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {status}
            </span>
            {run.platform && (
              <span className="text-[11px] text-muted-foreground">via {run.platform}</span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {run.summary ?? run.error ?? "Waiting for execution…"}
          </p>
        </div>
        <time className="shrink-0 text-[11px] text-muted-foreground">
          {run.createdAt ? new Date(run.createdAt).toLocaleString() : ""}
        </time>
        <ChevronDown
          size={15}
          className={`mt-0.5 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> Loading steps…
            </div>
          ) : steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No step details were recorded for this run.
            </p>
          ) : (
            <ol className="space-y-2">
              {steps.map((step) => (
                <li key={`${run.id}-${step.index}`} className="flex items-center gap-2 text-xs">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-muted text-[10px] text-muted-foreground">
                    {(step.index ?? 0) + 1}
                  </span>
                  <span className="font-medium text-foreground">
                    {step.tool ?? "agent reasoning"}
                  </span>
                  <span className="text-muted-foreground">{step.status ?? "done"}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
