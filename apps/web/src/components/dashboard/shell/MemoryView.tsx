"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Pencil, Pin, Plus, Search, Trash2, X } from "lucide-react"
import type { DashboardTab } from "@/components/dashboard/tabs"
import { cn } from "@/lib/utils"

type Memory = {
  id: string
  topic?: string | null
  kind?: string | null
  content: string
  summary?: string | null
  isStatic?: boolean
  updatedAt?: string | null
}

type GraphNode = {
  id: string
  topic?: string | null
  kind?: string | null
  label: string
  isStatic: boolean
}
type GraphEdge = { from: string; to: string; type: string }

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

function groupOf(memory: { topic?: string | null; kind?: string | null }) {
  return (memory.topic || memory.kind || "general").replace(/_/g, " ").toLowerCase()
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
        <div className="flex items-start gap-3">
          {memory.isStatic && (
            <Pin size={13} className="mt-1 shrink-0 text-[#2b8fff]" aria-label="Pinned" />
          )}
          <p className="flex-1 text-sm leading-relaxed">{memory.content}</p>
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
      )}
    </li>
  )

  return (
    <div className="space-y-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">memory</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {memories.length > 0 && !query
              ? `${memories.length} things yomi knows about you. `
              : ""}
            edit or forget anything, and yomi uses the change everywhere.
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
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> loading…
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
              {groups.map(([group, items]) => (
                <section key={group}>
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
        />
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

function GraphPanel({
  graph,
  selected,
  onSelect,
  memories,
  onForget,
}: {
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
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 size={15} className="animate-spin" /> drawing your memory…
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
      <div className="overflow-hidden rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]">
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
