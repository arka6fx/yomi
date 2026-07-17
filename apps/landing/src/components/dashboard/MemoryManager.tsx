"use client"

import { useCallback, useEffect, useState } from "react"
import { Brain, Loader2, Pin, Plus, Search, Trash2, X } from "lucide-react"

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

const KINDS = ["fact", "preference", "project", "decision", "open_thread"] as const
const SCOPES = ["global", "project", "app", "session"] as const

// Cloud memory management. Talks to the backend /api/memory/* endpoints (the same
// canonical store the Telegram agent reads), so edits here apply everywhere.
export function MemoryManager({ token }: { token: string }) {
  const [memories, setMemories] = useState<MemoryRow[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [forgetting, setForgetting] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft] = useState("")
  const [draftTopic, setDraftTopic] = useState("")
  const [draftKind, setDraftKind] = useState<(typeof KINDS)[number]>("fact")
  const [draftScope, setDraftScope] = useState<(typeof SCOPES)[number]>("global")
  const [saving, setSaving] = useState(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError("")
      try {
        const res = q.trim()
          ? await fetch("/api/memory/search", {
              method: "POST",
              headers: { ...auth, "Content-Type": "application/json" },
              body: JSON.stringify({ query: q.trim(), limit: 50 }),
            })
          : await fetch("/api/memory/entries?limit=100", { headers: auth })
        if (!res.ok) throw new Error(`Couldn't load memories (${res.status})`)
        const data = (await res.json()) as { memories?: MemoryRow[] }
        setMemories(data.memories ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load memories")
      } finally {
        setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, load])

  async function handleAdd() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/memory/add", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft.trim(),
          topic: draftTopic.trim() || undefined,
          kind: draftKind,
          scope: draftScope,
        }),
      })
      if (!res.ok) throw new Error("Couldn't save that memory")
      setDraft("")
      setDraftTopic("")
      setShowAdd(false)
      await load(query)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that memory")
    } finally {
      setSaving(false)
    }
  }

  async function handleForget(id: string) {
    setForgetting(id)
    setError("")
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: auth,
      })
      if (!res.ok) throw new Error("Couldn't forget that memory")
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't forget that memory")
    } finally {
      setForgetting(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
            <Brain size={20} className="text-primary" />
          </div>
          <div>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              What Yomi <span className="italic">remembers</span>
            </h2>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Durable facts Yomi keeps across your web app and Telegram. Add, search, or forget them
              here.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showAdd ? <X size={12} /> : <Plus size={12} />}
          {showAdd ? "Cancel" : "Add memory"}
        </button>
      </div>

      {showAdd && (
        <div className="mb-5 rounded-xl border border-border bg-background/40 p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Something Yomi should remember about you or your work…"
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={draftTopic}
              onChange={(e) => setDraftTopic(e.target.value)}
              placeholder="Topic (optional)"
              className="flex-1 min-w-[140px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />
            <select
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as (typeof KINDS)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("_", " ")}
                </option>
              ))}
            </select>
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as (typeof SCOPES)[number])}
              className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              onClick={handleAdd}
              disabled={!draft.trim() || saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Save
            </button>
          </div>
        </div>
      )}

      <div className="relative mb-4">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories"
          className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
        />
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading memories…
        </div>
      ) : memories.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? "No memories match that search" : "No memories yet"}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {query
              ? "Try a different term, or clear the search."
              : "Yomi adds memories as you work, or you can add one above."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {memories.map((m) => (
            <li
              key={m.id}
              className="group flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 transition-colors hover:border-border/80"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {m.isStatic && <Pin size={11} className="shrink-0 text-primary" />}
                  <span className="truncate text-sm font-medium text-foreground">
                    {m.topic || m.kind || "Memory"}
                  </span>
                  {m.kind && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">
                      {m.kind.replace("_", " ")}
                    </span>
                  )}
                  {m.scope && m.scope !== "global" && (
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {m.scope}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {m.summary || m.content}
                </p>
              </div>
              <button
                onClick={() => handleForget(m.id)}
                disabled={forgetting === m.id}
                aria-label="Forget memory"
                className="shrink-0 rounded-lg p-1.5 text-muted-foreground/60 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
              >
                {forgetting === m.id ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
