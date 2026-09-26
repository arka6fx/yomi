"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, Check, Copy, Loader2, RotateCcw } from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"
import { ListSkeleton } from "@/components/dashboard/shell/motion"
import { parseMarkdown, type Inline } from "@/lib/chat-markdown"

type Turn = {
  role: "user" | "assistant" | "system"
  content: string
  createdAt?: string | null
  failed?: boolean
}

const SUGGESTIONS = [
  "what's on my calendar today?",
  "anything important in my inbox?",
  "remind me at 6pm to call mum",
]

// Telegram messages show up here too; check for new ones while the page is open.
const POLL_MS = 15_000

function dayLabel(iso?: string | null): string {
  if (!iso) return ""
  const day = new Date(iso)
  if (Number.isNaN(day.getTime())) return ""
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (day.toDateString() === today.toDateString()) return "today"
  if (day.toDateString() === yesterday.toDateString()) return "yesterday"
  return day.toLocaleDateString(undefined, { day: "numeric", month: "short" }).toLowerCase()
}

function timeLabel(iso?: string | null): string {
  if (!iso) return ""
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase()
}

function InlineText({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        switch (part.type) {
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                {part.text}
              </strong>
            )
          case "italic":
            return <em key={i}>{part.text}</em>
          case "code":
            return (
              <code key={i} className="rounded-md bg-foreground/[0.06] px-1 py-0.5 text-[0.85em]">
                {part.text}
              </code>
            )
          case "link":
            return (
              <a
                key={i}
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
              >
                {part.text}
              </a>
            )
          default:
            return <Fragment key={i}>{part.text}</Fragment>
        }
      })}
    </>
  )
}

function Formatted({ text }: { text: string }) {
  return (
    <div className="space-y-2.5">
      {parseMarkdown(text).map((block, i) => {
        if (block.type === "heading")
          return (
            <p key={i} className="font-semibold">
              <InlineText parts={block.inline} />
            </p>
          )
        if (block.type === "code")
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl bg-foreground/[0.05] p-3 text-xs leading-relaxed"
            >
              {block.text}
            </pre>
          )
        if (block.type === "list")
          return (
            <ul key={i} className="space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{item.marker}</span>
                  <span className="min-w-0 whitespace-pre-line">
                    <InlineText parts={item.inline} />
                  </span>
                </li>
              ))}
            </ul>
          )
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <InlineText parts={line} />
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label="copy reply"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
}

function TypingDots() {
  return (
    <div className="flex justify-start" aria-label="yomi is typing">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-background px-4 py-3">
        {[0, 1, 2].map((n) => (
          <span
            key={n}
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
            style={{ animationDelay: `${n * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  )
}

// The one conversation Yomi keeps with you: the same thread as Telegram, so you can
// text from either place and pick up where you left off.
export function ConversationManager({ token }: { token: string }) {
  const [history, setHistory] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const res = await fetch("/api/conversation/shared", { headers: auth })
        if (!res.ok) throw new Error(`Couldn't load your conversation (${res.status})`)
        const data = (await res.json()) as { history?: Turn[] }
        // A reply in flight owns the thread; don't let a poll overwrite it.
        if (sendingRef.current) return
        setHistory((data.history ?? []).filter((t) => t.role !== "system"))
        if (!quiet) setError("")
      } catch (err) {
        if (!quiet) setError(err instanceof Error ? err.message : "Couldn't load your conversation")
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history.length, sending, loading])

  // The box grows with what you type, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  async function send(text: string) {
    const message = text.trim()
    if (!message || sending) return
    setDraft("")
    setError("")
    setConfirmReset(false)
    setSending(true)
    sendingRef.current = true
    const now = new Date().toISOString()
    setHistory((h) => [...h, { role: "user", content: message, createdAt: now }])
    try {
      const res = await fetch("/api/conversation/shared/send", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        reply?: Turn
        detail?: string
      }
      if (!res.ok || !data.reply) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Yomi couldn't reply")
      }
      setHistory((h) => [...h, { ...data.reply!, createdAt: new Date().toISOString() }])
    } catch (err) {
      setHistory((h) =>
        h.map((t, i) => (i === h.length - 1 && t.role === "user" ? { ...t, failed: true } : t)),
      )
      setError(err instanceof Error ? err.message : "Yomi couldn't reply")
    } finally {
      sendingRef.current = false
      setSending(false)
      input.current?.focus()
    }
  }

  function retry(index: number) {
    const turn = history[index]
    if (!turn) return
    setHistory((h) => h.filter((_, i) => i !== index))
    void send(turn.content)
  }

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setResetting(true)
    setError("")
    try {
      const res = await fetch("/api/conversation/shared/reset", { method: "POST", headers: auth })
      if (!res.ok) throw new Error("Couldn't reset the conversation")
      setHistory([])
      setConfirmReset(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the conversation")
    } finally {
      setResetting(false)
    }
  }

  return (
    <section className="space-y-6 pt-6">
      <PageHeader
        title="conversation"
        subtitle="text yomi here or on telegram; it's one thread. start fresh any time and the old one moves to history."
        actions={
          history.length > 0 && (
            <button
              onClick={handleReset}
              disabled={resetting || sending}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive disabled:opacity-50"
            >
              {resetting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              {confirmReset ? "Start fresh?" : "Start fresh"}
            </button>
          )
        }
      />
      <div
        className={cn(
          SURFACE,
          "flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col overflow-hidden",
        )}
      >
        <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading ? (
            <ListSkeleton label="loading your conversation" />
          ) : history.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <p className="text-base font-semibold text-foreground">say hi to yomi</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                ask anything, or try one of these. replies show up on telegram&apos;s thread too.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-foreground/30"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {history.map((turn, i) => {
                const day = dayLabel(turn.createdAt)
                const showDay = day && day !== dayLabel(history[i - 1]?.createdAt)
                const mine = turn.role === "user"
                return (
                  <Fragment key={i}>
                    {showDay && (
                      <li className="flex justify-center py-1">
                        <span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {day}
                        </span>
                      </li>
                    )}
                    <li className={cn("group flex flex-col", mine ? "items-end" : "items-start")}>
                      <div
                        className={cn(
                          "max-w-[88%] break-words px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
                          mine
                            ? "whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                            : "rounded-2xl rounded-bl-md border border-border/60 bg-background text-foreground",
                          turn.failed && "opacity-60",
                        )}
                      >
                        {mine ? turn.content : <Formatted text={turn.content} />}
                      </div>
                      <div className="mt-1 flex h-5 items-center gap-1 px-1 text-[11px] text-muted-foreground">
                        {turn.failed ? (
                          <button
                            onClick={() => retry(i)}
                            className="font-medium text-destructive hover:underline"
                          >
                            didn&apos;t send · retry
                          </button>
                        ) : (
                          <span>{timeLabel(turn.createdAt)}</span>
                        )}
                        {!mine && <CopyButton text={turn.content} />}
                      </div>
                    </li>
                  </Fragment>
                )
              })}
              {sending && (
                <li>
                  <TypingDots />
                </li>
              )}
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send(draft)
          }}
          className="border-t border-border/60 p-3 sm:p-4"
        >
          {error && <p className="mb-2 px-1 text-xs text-destructive">{error}</p>}
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 transition-colors focus-within:border-foreground/30">
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send(draft)
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder="message yomi"
              aria-label="message yomi"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="send"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            enter to send · shift+enter for a new line
          </p>
        </form>
      </div>
    </section>
  )
}
