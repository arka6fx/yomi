"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, History, Loader2, Search } from "lucide-react"
import { relativePast, truncate } from "@/lib/format"

type SessionCard = {
  id: string
  title: string | null
  summary: string | null
  messageCount: number
  platform: string | null
  lastMessageAt: string | null
  closedAt: string | null
  lastMessage: { role: string; content: string } | null
}

type SessionDetail = {
  id: string
  title: string | null
  summary: string | null
  platform: string
  closedAt: string | null
  messages: { role: string; content: string; createdAt: string }[]
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function groupByRecency(sessions: SessionCard[]): { label: string; sessions: SessionCard[] }[] {
  const cutoff = Date.now() - WEEK_MS
  const thisWeek = sessions.filter((s) => new Date(s.lastMessageAt ?? 0).getTime() >= cutoff)
  const earlier = sessions.filter((s) => new Date(s.lastMessageAt ?? 0).getTime() < cutoff)
  const groups: { label: string; sessions: SessionCard[] }[] = []
  if (thisWeek.length > 0) groups.push({ label: "This week", sessions: thisWeek })
  if (earlier.length > 0) groups.push({ label: "Earlier", sessions: earlier })
  return groups
}

// Your past conversations with Yomi, across Telegram and web. A list view
// grouped by recency (with search) and a read-only transcript detail view.
export function HistoryManager({ token }: { token: string }) {
  const [sessions, setSessions] = useState<SessionCard[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState("")

  const auth = { Authorization: `Bearer ${token}` }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(
    async (opts: { q?: string; cursor?: string } = {}) => {
      const isMore = Boolean(opts.cursor)
      if (isMore) setLoadingMore(true)
      else setLoading(true)
      setError("")
      try {
        const params = new URLSearchParams({ limit: "20" })
        if (opts.q) params.set("q", opts.q)
        if (opts.cursor) params.set("cursor", opts.cursor)
        const res = await fetch(`/api/history/sessions?${params}`, { headers: auth })
        if (!res.ok) throw new Error(`Couldn't load your history (${res.status})`)
        const data = (await res.json()) as { sessions?: SessionCard[] }
        const page = data.sessions ?? []
        setSessions((prev) => (isMore ? [...prev, ...page] : page))
        setHasMore(page.length >= 20 && !opts.q)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load your history")
      } finally {
        if (isMore) setLoadingMore(false)
        else setLoading(false)
      }
    },
    [token],
  )

  const isFirstRun = useRef(true)

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false
      void load()
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void load({ q: query.trim() || undefined })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, load])

  async function openSession(id: string) {
    setSelectedId(id)
    setDetail(null)
    setDetailError("")
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/history/sessions/${id}`, { headers: auth })
      if (!res.ok) throw new Error(`Couldn't load this conversation (${res.status})`)
      const data = (await res.json()) as SessionDetail
      setDetail(data)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Couldn't load this conversation")
    } finally {
      setDetailLoading(false)
    }
  }

  if (selectedId) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <button
          onClick={() => setSelectedId(null)}
          className="mb-4 flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Back to history
        </button>

        {detailLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Loading conversation…
          </div>
        ) : detailError ? (
          <p className="text-xs text-destructive">{detailError}</p>
        ) : detail ? (
          <>
            <h2 className="font-serif text-2xl leading-tight text-foreground">
              {detail.title ?? "Conversation"}
            </h2>
            {detail.closedAt && (
              <p className="mt-1 text-xs text-muted-foreground">{relativePast(detail.closedAt)}</p>
            )}
            <ul className="mt-5 space-y-3">
              {detail.messages.map((turn, i) => (
                <li
                  key={i}
                  className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
                >
                  <div
                    className={
                      turn.role === "user"
                        ? "max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground"
                        : "max-w-[80%] rounded-2xl rounded-bl-sm border border-border bg-background/40 px-3.5 py-2 text-sm text-foreground"
                    }
                  >
                    <p className="whitespace-pre-wrap break-words leading-relaxed">
                      {turn.content}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3.5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10">
          <History size={20} className="text-primary" />
        </div>
        <div>
          <h2 className="font-serif text-2xl leading-tight text-foreground">
            Your <span className="italic">history</span>
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Your past conversations with Yomi, across Telegram and web. Open one to see the full
            transcript.
          </p>
        </div>
      </div>

      <div className="relative mb-5">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations…"
          className="w-full rounded-xl border border-border bg-background/60 py-2.5 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
        />
      </div>

      {error && <p className="mb-3 text-xs text-destructive">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Loading your history…
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? "No matching conversations" : "No conversations yet"}
          </p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
            {query
              ? "Try a different search term."
              : "Talk to Yomi on Telegram and past conversations show up here once they wrap up."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupByRecency(sessions).map((group) => (
            <div key={group.label}>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {group.label}
                <span className="text-muted-foreground/60">{group.sessions.length}</span>
              </p>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {group.sessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => openSession(session.id)}
                    className="flex w-full items-start justify-between gap-3 bg-background/40 px-4 py-3.5 text-left transition-colors hover:bg-background/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {session.title ?? "Untitled conversation"}
                      </p>
                      {session.lastMessage && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          <span className="text-muted-foreground/70">
                            {session.lastMessage.role === "user" ? "you" : "yomi"}
                          </span>{" "}
                          {truncate(session.lastMessage.content, 90)}
                        </p>
                      )}
                      {session.lastMessageAt && (
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          {relativePast(session.lastMessageAt)}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => {
                const last = sessions[sessions.length - 1]
                if (last?.lastMessageAt) void load({ cursor: last.lastMessageAt })
              }}
              disabled={loadingMore}
              className="w-full rounded-xl border border-border py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
