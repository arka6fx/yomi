"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useReducedMotion } from "framer-motion"
import {
  ChevronRight,
  Download,
  Loader2,
  MoreHorizontal,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { Skeleton } from "@/components/dashboard/shell/motion"
import { cn } from "@/lib/utils"

type Memory = {
  id: string
  topic?: string | null
  kind?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
  createdAt?: string | null
  sourceType?: string | null
  version?: number | null
  confidence?: number | null
}

type GraphNode = {
  id: string
  topic?: string | null
  kind?: string | null
  label: string
  isStatic: boolean
}
type GraphEdge = { from: string; to: string; type: string }

const IMPORT_PLACEHOLDER = "- lives in Kolkata\n- vegetarian\n- works as a designer"

const KINDS = ["fact", "preference", "project", "decision", "open_thread"] as const
const PALETTE = [
  "#2b8fff",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
  "#64748b",
]

function groupOf(memory: {
  topic?: string | null
  kind?: string | null
  sourceType?: string | null
}) {
  const imported = memory.sourceType?.match(/^import:(\w+)/)?.[1]
  if (imported) return imported === "other" ? "imported" : `imported from ${imported}`
  return (memory.topic || memory.kind || "general").replace(/_/g, " ").toLowerCase()
}

const SOURCES: Record<string, string> = {
  dashboard: "you added it here on the dashboard",
  "import:chatgpt": "imported from ChatGPT",
  "import:claude": "imported from Claude",
  "import:other": "imported from another assistant",
}

// Where a memory came from, in words. No source means yomi picked it up in chat.
function sourceOf(memory: Memory) {
  if (!memory.sourceType) return "something you told yomi in chat"
  return SOURCES[memory.sourceType] ?? memory.sourceType.replace(/[_:]/g, " ")
}

function shortDate(iso?: string | null) {
  if (!iso) return ""
  const d = new Date(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return ""
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

// A small force-directed layout, run once: repulsion between all nodes, springs on
// edges, and a pull toward each topic's anchor so topics cluster.
function layout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const groups = [...new Set(nodes.map(groupOf))]
  const anchors = Object.fromEntries(
    groups.map((group, i) => {
      const angle = (i / Math.max(groups.length, 1)) * Math.PI * 2
      return [
        group,
        {
          x: width / 2 + Math.cos(angle) * width * 0.28,
          y: height / 2 + Math.sin(angle) * height * 0.28,
        },
      ]
    }),
  )
  const pos = nodes.map((node, i) => {
    const anchor = anchors[groupOf(node)] ?? { x: width / 2, y: height / 2 }
    return { x: anchor.x + Math.cos(i * 2.4) * 30, y: anchor.y + Math.sin(i * 2.4) * 30 }
  })
  const index = Object.fromEntries(nodes.map((node, i) => [node.id, i]))
  for (let step = 0; step < 220; step++) {
    const force = pos.map(() => ({ x: 0, y: 0 }))
    for (let a = 0; a < pos.length; a++) {
      for (let b = a + 1; b < pos.length; b++) {
        const dx = pos[a]!.x - pos[b]!.x
        const dy = pos[a]!.y - pos[b]!.y
        const d2 = Math.max(dx * dx + dy * dy, 25)
        const push = 140 / d2
        force[a]!.x += dx * push
        force[a]!.y += dy * push
        force[b]!.x -= dx * push
        force[b]!.y -= dy * push
      }
    }
    for (const edge of edges) {
      const a = index[edge.from]
      const b = index[edge.to]
      if (a === undefined || b === undefined) continue
      const dx = pos[b]!.x - pos[a]!.x
      const dy = pos[b]!.y - pos[a]!.y
      force[a]!.x += dx * 0.02
      force[a]!.y += dy * 0.02
      force[b]!.x -= dx * 0.02
      force[b]!.y -= dy * 0.02
    }
    nodes.forEach((node, i) => {
      const anchor = anchors[groupOf(node)]!
      force[i]!.x += (anchor.x - pos[i]!.x) * 0.04
      force[i]!.y += (anchor.y - pos[i]!.y) * 0.04
      pos[i]!.x = Math.min(
        width - 20,
        Math.max(20, pos[i]!.x + Math.max(-8, Math.min(8, force[i]!.x))),
      )
      pos[i]!.y = Math.min(
        height - 20,
        Math.max(20, pos[i]!.y + Math.max(-8, Math.min(8, force[i]!.y))),
      )
    })
  }
  return { pos, index, groups }
}

export function MemoryView({
  token,
  onNavigate,
}: {
  token: string
  onNavigate: (tab: DashboardTab) => void
}) {
  const [view, setView] = useState<"list" | "graph">("list")
  const [memories, setMemories] = useState<Memory[]>([])
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [consentNeeded, setConsentNeeded] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({
    content: "",
    topic: "",
    kind: "fact" as (typeof KINDS)[number],
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState("everything")
  const [openId, setOpenId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState("")
  const [importSource, setImportSource] = useState<"chatgpt" | "claude" | "other">("chatgpt")
  const [notice, setNotice] = useState("")
  const [dim, setDim] = useState<"2d" | "3d">("2d")

  const headers = useMemo(
    () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" }),
    [token],
  )

  const handle = useCallback(async (res: Response) => {
    if (res.status === 403) {
      setConsentNeeded(true)
      throw new Error("Memory is switched off in your privacy settings")
    }
    if (!res.ok) throw new Error("Couldn’t load your memory")
    return res.json()
  }, [])

  const load = useCallback(
    async (q: string) => {
      setLoading(true)
      setError("")
      try {
        const data = (await handle(
          q.trim()
            ? await fetch("/api/memory/search", {
                method: "POST",
                headers,
                body: JSON.stringify({ query: q.trim(), limit: 50 }),
              })
            : await fetch("/api/memory/entries?limit=200", { headers }),
        )) as { memories?: Memory[] }
        setMemories(data.memories ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn’t load your memory")
      } finally {
        setLoading(false)
      }
    },
    [handle, headers],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(query), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, load])

  useEffect(() => {
    if (view !== "graph" || graph) return
    void fetch("/api/memory/graph", { headers })
      .then(handle)
      .then((data) => setGraph(data as { nodes: GraphNode[]; edges: GraphEdge[] }))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Couldn’t load the graph"),
      )
  }, [view, graph, headers, handle])

  async function save(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ content: editText.trim() }),
      })
      if (!res.ok) throw new Error()
      setEditing(null)
      setGraph(null)
      await load(query)
    } catch {
      setError("Couldn’t save that change")
    } finally {
      setBusy(null)
    }
  }

  async function forget(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
      })
      if (!res.ok) throw new Error()
      setMemories((current) => current.filter((m) => m.id !== id))
      setGraph(null)
      setSelected(null)
    } catch {
      setError("Couldn’t forget that")
    } finally {
      setBusy(null)
    }
  }

  async function add() {
    if (!draft.content.trim()) return
    setBusy("new")
    try {
      const res = await fetch("/api/memory/add", {
        method: "POST",
        headers,
        body: JSON.stringify({
          content: draft.content.trim(),
          topic: draft.topic.trim() || undefined,
          kind: draft.kind,
          scope: "global",
          sourceType: "dashboard",
        }),
      })
      if (!res.ok) throw new Error()
      setDraft({ content: "", topic: "", kind: "fact" })
      setAdding(false)
      setGraph(null)
      await load(query)
    } catch {
      setError("Couldn’t save that memory")
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    setMenuOpen(false)
    try {
      const data = await handle(await fetch("/api/privacy/memories/export", { headers }))
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = "yomi-memories.json"
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t download your memories")
    }
  }

  async function runImport() {
    if (!importText.trim()) return
    setBusy("import")
    setError("")
    try {
      const res = await fetch("/api/memory/import", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: importText, source: importSource }),
      })
      const data = (await res.json().catch(() => ({}))) as { imported?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Couldn’t import that")
      setNotice(`brought over ${data.imported ?? 0} memories.`)
      setImporting(false)
      setImportText("")
      setGraph(null)
      await load(query)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t import that")
    } finally {
      setBusy(null)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, Memory[]>()
    for (const memory of memories) {
      const key = groupOf(memory)
      map.set(key, [...(map.get(key) ?? []), memory])
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [memories])

  const card =
    "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"

  const memoryCard = (memory: Memory) => (
    <li key={memory.id} className="group px-4 py-3">
      {editing === memory.id ? (
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={(event) => setEditText(event.target.value)}
            rows={3}
            autoFocus
            className="w-full resize-none rounded-2xl bg-muted px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2b8fff]"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              className="rounded-full bg-muted px-3 py-1.5 text-xs font-semibold"
            >
              cancel
            </button>
            <button
              onClick={() => void save(memory.id)}
              disabled={busy === memory.id || !editText.trim()}
              className="rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
            >
              save
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            {memory.isStatic && (
              <Pin size={13} className="mt-1 shrink-0 text-[#2b8fff]" aria-label="Pinned" />
            )}
            <button
              onClick={() => setOpenId(openId === memory.id ? null : memory.id)}
              aria-expanded={openId === memory.id}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block text-sm leading-relaxed">{memory.content}</span>
              {shortDate(memory.createdAt ?? memory.updatedAt) && (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {shortDate(memory.createdAt ?? memory.updatedAt)}
                </span>
              )}
            </button>
            <ChevronRight
              size={15}
              aria-hidden
              className={cn(
                "mt-1 shrink-0 text-muted-foreground/60 transition-transform",
                openId === memory.id && "rotate-90",
              )}
            />
            <div className="flex shrink-0 gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                onClick={() => {
                  setEditing(memory.id)
                  setEditText(memory.content)
                }}
                aria-label="Edit memory"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => void forget(memory.id)}
                disabled={busy === memory.id}
                aria-label="Forget memory"
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {openId === memory.id && (
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 rounded-2xl bg-muted/60 p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">where it came from</dt>
                <dd className="font-medium">{sourceOf(memory)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">learned</dt>
                <dd className="font-medium">{shortDate(memory.createdAt) || "unknown"}</dd>
              </div>
              {(memory.version ?? 1) > 1 && (
                <div>
                  <dt className="text-muted-foreground">updated</dt>
                  <dd className="font-medium">
                    {(memory.version ?? 1) - 1} time{(memory.version ?? 1) - 1 === 1 ? "" : "s"},
                    last on {shortDate(memory.updatedAt)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">filed under</dt>
                <dd className="font-medium">{groupOf(memory)}</dd>
              </div>
            </dl>
          )}
        </>
      )}
    </li>
  )

  return (
    <div className="page-fade space-y-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            what yomi knows about you
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            every line came from something you said. tap one to see where. edit or forget anything,
            and yomi uses the change everywhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-card p-1 shadow-sm" role="group" aria-label="View">
            {(["list", "graph"] as const).map((name) => (
              <button
                key={name}
                onClick={() => setView(name)}
                aria-pressed={view === name}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-sm font-semibold",
                  view === name ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-semibold shadow-sm hover:bg-muted"
          >
            <Plus size={15} /> add
          </button>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="More memory options"
              aria-expanded={menuOpen}
              className="grid size-9 place-items-center rounded-full bg-card shadow-sm hover:bg-muted"
            >
              <MoreHorizontal size={16} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-20 w-64 rounded-2xl bg-card p-1.5 shadow-lg ring-1 ring-border">
                <button
                  onClick={() => void download()}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                >
                  <Download size={14} /> download your memories
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setImporting(true)
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-muted"
                >
                  <Upload size={14} /> import from ChatGPT / Claude
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {error}
          {consentNeeded && (
            <>
              {" · "}
              <button
                onClick={() => onNavigate("privacy")}
                className="font-semibold underline-offset-2 hover:underline"
              >
                privacy settings
              </button>
            </>
          )}
        </p>
      )}

      {notice && <p className="text-sm text-emerald-600">{notice}</p>}

      {view === "list" ? (
        <>
          <label className={cn(card, "flex items-center gap-3 px-5 py-3.5")}>
            <Search size={16} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search what yomi knows"
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

          {loading ? (
            <div className="space-y-6" aria-busy="true" aria-label="loading memories">
              {[0, 1].map((n) => (
                <div key={n} className="space-y-2">
                  <Skeleton className="h-5 w-32 rounded-full" />
                  <Skeleton className="h-40 rounded-[1.75rem]" />
                </div>
              ))}
            </div>
          ) : memories.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-3xl font-bold tracking-tight">
                {query ? "nothing matches." : "nothing yet."}
              </p>
              {!query && (
                <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
                  tell yomi about yourself on telegram (where you live, what you do, what you like)
                  and it remembers.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {!query && groups.length > 1 && (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
                  {[
                    ["everything", memories.length] as const,
                    ...groups.map(([name, items]) => [name, items.length] as const),
                  ].map(([name, count]) => (
                    <button
                      key={name}
                      onClick={() => setFilter(name)}
                      aria-pressed={filter === name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold",
                        filter === name
                          ? "bg-foreground text-background"
                          : "bg-card shadow-sm hover:bg-muted",
                      )}
                    >
                      {name}
                      <span className={filter === name ? "opacity-60" : "text-muted-foreground"}>
                        {count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {groups
                .filter(([group]) => filter === "everything" || query || group === filter)
                .map(([group, items], i) => (
                  <section
                    key={group}
                    className="rise"
                    style={{ "--i": Math.min(i, 11) } as React.CSSProperties}
                  >
                    <h2 className="mb-2 flex items-baseline gap-2 text-lg font-bold tracking-tight">
                      {group}{" "}
                      <span className="text-sm font-medium text-muted-foreground">
                        {items.length}
                      </span>
                    </h2>
                    <ul className={cn(card, "divide-y divide-border overflow-hidden")}>
                      {items.map(memoryCard)}
                    </ul>
                  </section>
                ))}
              {!query && (
                <p className="px-1 text-sm text-muted-foreground">
                  {memories.length} {memories.length === 1 ? "thing" : "things"} yomi knows
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <GraphPanel
          graph={graph}
          selected={selected}
          onSelect={setSelected}
          memories={memories}
          onForget={forget}
          dim={dim}
          onDim={setDim}
        />
      )}

      {importing && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Import memories"
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setImporting(false)}
          />
          <div className="relative w-full max-w-lg space-y-4 rounded-t-[2rem] bg-card p-6 shadow-2xl sm:rounded-[2rem]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">bring your memories over</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  ask the other assistant to list everything it remembers about you, then paste its
                  answer here. one memory per line.
                </p>
              </div>
              <button
                onClick={() => setImporting(false)}
                aria-label="Close"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex gap-1.5" role="group" aria-label="Where from">
              {(["chatgpt", "claude", "other"] as const).map((src) => (
                <button
                  key={src}
                  onClick={() => setImportSource(src)}
                  aria-pressed={importSource === src}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-semibold",
                    importSource === src ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  {src === "chatgpt" ? "ChatGPT" : src === "claude" ? "Claude" : "other"}
                </button>
              ))}
            </div>
            <textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              rows={8}
              placeholder={IMPORT_PLACEHOLDER}
              className="w-full resize-none rounded-2xl bg-muted px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#2b8fff]"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                up to 200 lines. you can forget any of them later.
              </p>
              <button
                onClick={() => void runImport()}
                disabled={busy === "import" || !importText.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
              >
                {busy === "import" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Upload size={14} />
                )}{" "}
                import
              </button>
            </div>
          </div>
        </div>
      )}

      {adding && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Add memory"
        >
          <button
            aria-label="Close"
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setAdding(false)}
          />
          <div className="relative w-full max-w-lg rounded-t-[2rem] bg-card p-6 shadow-2xl sm:rounded-[2rem]">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold tracking-tight">teach yomi something</h2>
              <button
                onClick={() => setAdding(false)}
                aria-label="Close"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X size={16} />
              </button>
            </div>
            <textarea
              value={draft.content}
              onChange={(event) => setDraft((d) => ({ ...d, content: event.target.value }))}
              rows={3}
              placeholder="I’m vegetarian and allergic to peanuts."
              className="mt-5 w-full resize-none rounded-2xl bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#2b8fff]"
            />
            <input
              value={draft.topic}
              onChange={(event) => setDraft((d) => ({ ...d, topic: event.target.value }))}
              placeholder="topic (optional), e.g. food"
              className="mt-3 w-full rounded-2xl bg-muted px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#2b8fff]"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {KINDS.map((kind) => (
                <button
                  key={kind}
                  onClick={() => setDraft((d) => ({ ...d, kind }))}
                  aria-pressed={draft.kind === kind}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    draft.kind === kind ? "bg-foreground text-background" : "bg-muted",
                  )}
                >
                  {kind.replace("_", " ")}
                </button>
              ))}
            </div>
            <button
              onClick={() => void add()}
              disabled={busy === "new" || !draft.content.trim()}
              className="mt-5 w-full rounded-full bg-foreground py-3 text-sm font-semibold text-background disabled:opacity-50"
            >
              {busy === "new" ? (
                <Loader2 size={15} className="mx-auto animate-spin" />
              ) : (
                "remember this"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// 3D view: memories on a sphere, grouped by topic so each topic forms a band. It
// turns slowly on its own and follows a drag; nearer dots are bigger and brighter.
function Graph3D({
  graph,
  selected,
  onSelect,
  color,
}: {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  selected: string | null
  onSelect: (id: string | null) => void
  color: (node: GraphNode) => string | undefined
}) {
  const width = 900
  const height = 560
  const reduce = useReducedMotion()
  const [angle, setAngle] = useState(0)
  const [tilt, setTilt] = useState(0.35)
  const drag = useRef<{ x: number; y: number } | null>(null)

  const points = useMemo(() => {
    const order = [...graph.nodes].sort((a, b) => groupOf(a).localeCompare(groupOf(b)))
    const n = order.length
    const golden = Math.PI * (3 - Math.sqrt(5))
    return Object.fromEntries(
      order.map((node, i) => {
        const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
        const r = Math.sqrt(1 - y * y)
        return [node.id, { x: Math.cos(i * golden) * r, y, z: Math.sin(i * golden) * r }]
      }),
    )
  }, [graph.nodes])

  useEffect(() => {
    if (reduce) return
    let frame = 0
    const spin = () => {
      if (!drag.current) setAngle((a) => a + 0.0035)
      frame = requestAnimationFrame(spin)
    }
    frame = requestAnimationFrame(spin)
    return () => cancelAnimationFrame(frame)
  }, [reduce])

  const radius = Math.min(width, height) * 0.38
  const project = (id: string) => {
    const p = points[id]
    if (!p) return null
    const x1 = p.x * Math.cos(angle) - p.z * Math.sin(angle)
    const z1 = p.x * Math.sin(angle) + p.z * Math.cos(angle)
    const y2 = p.y * Math.cos(tilt) - z1 * Math.sin(tilt)
    const z2 = p.y * Math.sin(tilt) + z1 * Math.cos(tilt)
    const scale = 2.6 / (2.6 + z2)
    return { x: width / 2 + x1 * radius * scale, y: height / 2 + y2 * radius * scale, z: z2, scale }
  }

  const drawn = graph.nodes
    .map((node) => ({ node, p: project(node.id) }))
    .filter((d): d is { node: GraphNode; p: NonNullable<ReturnType<typeof project>> } => !!d.p)
    .sort((a, b) => b.p.z - a.p.z)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full touch-none select-none"
      role="img"
      aria-label="Memory graph in 3D"
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        setAngle((a) => a + (e.clientX - drag.current!.x) * 0.008)
        setTilt((t) => Math.max(-1.2, Math.min(1.2, t + (e.clientY - drag.current!.y) * 0.008)))
        drag.current = { x: e.clientX, y: e.clientY }
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    >
      {graph.edges.map((edge, i) => {
        const a = project(edge.from)
        const b = project(edge.to)
        if (!a || !b) return null
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeOpacity={0.08 + 0.12 * (1 - (a.z + b.z + 2) / 4)}
          />
        )
      })}
      {drawn.map(({ node, p }) => {
        const active = node.id === selected
        return (
          <g
            key={node.id}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(active ? null : node.id)}
            className="cursor-pointer"
            role="button"
            aria-label={node.label}
            opacity={0.35 + 0.65 * (1 - (p.z + 1) / 2)}
          >
            <title>{node.label}</title>
            <circle
              r={(active ? 11 : node.isStatic ? 8 : 6.5) * p.scale}
              fill={color(node)}
              stroke={active ? "currentColor" : "none"}
              strokeWidth={2}
            />
          </g>
        )
      })}
    </svg>
  )
}

function GraphPanel({
  graph,
  selected,
  onSelect,
  memories,
  onForget,
  dim,
  onDim,
}: {
  dim: "2d" | "3d"
  onDim: (dim: "2d" | "3d") => void
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null
  selected: string | null
  onSelect: (id: string | null) => void
  memories: Memory[]
  onForget: (id: string) => void
}) {
  const width = 900
  const height = 560
  const labelled = (graph?.nodes.length ?? 0) <= 40
  // Leave room on the right for labels so the last column doesn't clip.
  const computed = useMemo(
    () => (graph ? layout(graph.nodes, graph.edges, labelled ? width - 170 : width, height) : null),
    [graph, labelled],
  )

  if (!graph || !computed) {
    return (
      <div aria-busy="true" aria-label="drawing your memory">
        <Skeleton className="h-[420px] rounded-[1.75rem]" />
      </div>
    )
  }
  if (graph.nodes.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">nothing to draw yet.</p>
  }

  const showLabels = labelled
  const color = (node: GraphNode) =>
    PALETTE[computed.groups.indexOf(groupOf(node)) % PALETTE.length]
  const picked = graph.nodes.find((node) => node.id === selected)
  const full = memories.find((m) => m.id === selected)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div
          className="flex rounded-full bg-card p-1 shadow-sm"
          role="group"
          aria-label="Graph view"
        >
          {(["2d", "3d"] as const).map((name) => (
            <button
              key={name}
              onClick={() => onDim(name)}
              aria-pressed={dim === name}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold",
                dim === name ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]">
        {dim === "3d" ? (
          <Graph3D graph={graph} selected={selected} onSelect={onSelect} color={color} />
        ) : (
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
            role="img"
            aria-label="Memory graph"
          >
            {graph.edges.map((edge, i) => {
              const a = computed.pos[computed.index[edge.from]!]
              const b = computed.pos[computed.index[edge.to]!]
              if (!a || !b) return null
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="currentColor"
                  strokeOpacity={0.15}
                />
              )
            })}
            {graph.nodes.map((node, i) => {
              const p = computed.pos[i]!
              const active = node.id === selected
              return (
                <g
                  key={node.id}
                  transform={`translate(${p.x},${p.y})`}
                  onClick={() => onSelect(active ? null : node.id)}
                  className="cursor-pointer"
                  role="button"
                  aria-label={node.label}
                >
                  <title>{node.label}</title>
                  <circle
                    r={active ? 10 : node.isStatic ? 8 : 6}
                    fill={color(node)}
                    stroke={active ? "currentColor" : "none"}
                    strokeWidth={2}
                  />
                  {showLabels && (
                    <text
                      x={12}
                      y={4}
                      fontSize={12}
                      fill="currentColor"
                      fillOpacity={active ? 1 : 0.7}
                    >
                      {node.label.length > 26 ? `${node.label.slice(0, 25)}…` : node.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {computed.groups.map((group, i) => (
          <span key={group} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />{" "}
            {group}
          </span>
        ))}
        <span>· {graph.edges.length} connections · tap a dot</span>
      </div>
      {picked && (
        <div className="flex items-start gap-3 rounded-[1.5rem] bg-card p-4 shadow-sm">
          <span
            className="mt-1.5 size-2.5 shrink-0 rounded-full"
            style={{ background: color(picked) }}
          />
          <p className="flex-1 text-sm">{full?.content ?? picked.label}</p>
          <button
            onClick={() => onForget(picked.id)}
            aria-label="Forget memory"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
