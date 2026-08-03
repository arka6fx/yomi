"use client"

import { useEffect, useState } from "react"
import { Loader2, RotateCcw } from "lucide-react"
import type { MemoryRow } from "./memory-types"

type SupersededRow = MemoryRow & { replacedBy: MemoryRow | null }

export function MemoryHistoryView({ token, refreshKey }: { token: string; refreshKey: number }) {
  const [rows, setRows] = useState<SupersededRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load() {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/memory/superseded?limit=200", {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Couldn't load history (${res.status})`)
      const data = (await res.json()) as { memories?: SupersededRow[] }
      setRows(data.memories ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load history")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // load isn't memoized; refetch only on refreshKey change, not on every render
    void load()
  }, [refreshKey])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" />
        Loading history…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
        <p className="text-xs text-destructive">{error}</p>
        <button
          onClick={() => void load()}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
        <p className="text-sm font-medium text-foreground">No history yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Memories that get updated or replaced will show up here.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex items-start gap-3 rounded-xl border border-border bg-background/40 px-4 py-3"
        >
          <RotateCcw size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium text-foreground">
                {row.topic || row.kind || "Memory"}
              </span>
              {row.kind && (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                  {row.kind.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground line-through decoration-muted-foreground/40">
              {row.summary || row.content}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {row.replacedBy
                ? `Replaced by: ${row.replacedBy.topic || row.replacedBy.summary || row.replacedBy.content}`
                : "No longer active"}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
