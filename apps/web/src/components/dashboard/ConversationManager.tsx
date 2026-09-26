"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { ArrowUp, Check, Copy, Loader2, RotateCcw, Sparkles } from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"
import { ListSkeleton } from "@/components/dashboard/shell/motion"
import { closeOpenMarks, parseMarkdown, type Inline } from "@/lib/chat-markdown"
import { readNdjson } from "@/lib/ndjson"

type Turn = {
  role: "user" | "assistant" | "system"
  content: string
  createdAt?: string | null
  failed?: boolean
}

type StreamEvent =
  | { type: "tool"; name: string; label: string }
  | { type: "text"; text: string }
  | { type: "done"; reply: string }
  | { type: "error"; message: string }

/** The reply being written right now. */
type Live = { text: string; status: string | null; reply: string | null }

const SUGGESTIONS = [
  "what's on my calendar today?",
  "anything important in my inbox?",
  "remind me at 6pm to call mum",
]

// Telegram messages show up here too; check for new ones while the page is open.
const POLL_MS = 15_000

const SPRING = { type: "spring", stiffness: 380, damping: 30 } as const

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

/**
 * Text arrives from the model in uneven bursts; this lets it out at a steady pace,
 * faster when there's a backlog, so the reply reads like it's being typed.
 */
function useSmoothText(target: string): string {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)

  useEffect(() => {
    if (reduce || !target.startsWith(shownRef.current)) {
      shownRef.current = target
      setShown(target)
      return
    }
    let frame = 0
    const tick = () => {
      const current = shownRef.current
      if (current.length >= target.length) return
      const backlog = target.length - current.length
      const next = target.slice(0, current.length + Math.max(2, Math.ceil(backlog / 8)))
      shownRef.current = next
      setShown(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, reduce])

  return shown
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

function Formatted({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parseMarkdown(caret ? closeOpenMarks(text) : text)
  const cursor = <span aria-hidden className="stream-caret" />
  if (blocks.length === 0) return caret ? cursor : null
  return (
    <div className="space-y-2.5">
      {blocks.map((block, i) => {
        const end = caret && i === blocks.length - 1 ? cursor : null
        if (block.type === "heading")
          return (
            <p key={i} className="font-semibold">
              <InlineText parts={block.inline} />
              {end}
            </p>
          )
        if (block.type === "code")
          return (
            <pre
              key={i}
              className="overflow-x-auto rounded-xl bg-foreground/[0.05] p-3 text-xs leading-relaxed"
            >
              {block.text}
              {end}
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
                    {j === block.items.length - 1 && end}
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
            {end}
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
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "done" : "copy"}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="block"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/** What Yomi is doing before words arrive: bouncing dots, or the tool it's using. */
function Status({ label }: { label: string | null }) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm" aria-live="polite">
      <Sparkles size={14} className="shrink-0 text-muted-foreground" />
      <AnimatePresence mode="wait" initial={false}>
        {label ? (
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.25 }}
            className="text-shimmer font-medium"
          >
            {label}…
          </motion.span>
        ) : (
          <motion.span
            key="thinking"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1"
            aria-label="yomi is thinking"
          >
            {[0, 1, 2].map((n) => (
              <motion.span
                key={n}
                className="size-1.5 rounded-full bg-muted-foreground/70"
                animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: n * 0.15 }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

const ASSISTANT_BUBBLE =
  "rounded-2xl rounded-bl-md border border-border/60 bg-background text-foreground"

// The one conversation Yomi keeps with you: the same thread as Telegram, so you can
// text from either place and pick up where you left off. Replies stream in as
// they're written.
export function ConversationManager({ token }: { token: string }) {
  const [history, setHistory] = useState<Turn[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState("")
  const [live, setLive] = useState<Live | null>(null)
  // Messages already on screen when the page loaded don't animate in.
  const [settled, setSettled] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const pinned = useRef(true)
  const reduce = useReducedMotion()

  const sending = live !== null
  const shown = useSmoothText(live?.text ?? "")

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
        const turns = (data.history ?? []).filter((t) => t.role !== "system")
        setHistory(turns)
        if (!quiet) {
          setSettled(turns.length)
          setError("")
        }
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

  // Follow the newest message, unless you've scrolled up to read something.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [history.length, shown, live?.status, loading])

  // The box grows with what you type, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  // Once the typed-out text has caught up with the finished reply, it joins the thread.
  useEffect(() => {
    if (!live || live.reply === null || shown.length < live.text.length) return
    const reply = live.reply
    setHistory((h) => [
      ...h,
      { role: "assistant", content: reply, createdAt: new Date().toISOString() },
    ])
    setLive(null)
    sendingRef.current = false
    input.current?.focus()
  }, [live, shown])

  function fail(message: string) {
    setHistory((h) =>
      h.map((t, i) => (i === h.length - 1 && t.role === "user" ? { ...t, failed: true } : t)),
    )
    setError(message)
    setLive(null)
    sendingRef.current = false
  }

  async function send(text: string) {
    const message = text.trim()
    if (!message || sendingRef.current) return
    sendingRef.current = true
    pinned.current = true
    setDraft("")
    setError("")
    setConfirmReset(false)
    setHistory((h) => [
      ...h,
      { role: "user", content: message, createdAt: new Date().toISOString() },
    ])
    setLive({ text: "", status: null, reply: null })
    try {
      const res = await fetch("/api/conversation/shared/stream", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { detail?: unknown }
        throw new Error(typeof data.detail === "string" ? data.detail : "Yomi couldn't reply")
      }
      let finished = false
      await readNdjson<StreamEvent>(res.body, (event) => {
        if (event.type === "text") {
          setLive((l) => l && { ...l, text: l.text + event.text, status: null })
        } else if (event.type === "tool") {
          // Anything said before a tool was thinking out loud; the answer comes after.
          setLive((l) => l && { ...l, text: "", status: event.label })
        } else if (event.type === "done") {
          finished = true
          setLive((l) => l && { ...l, text: event.reply, status: null, reply: event.reply })
        } else if (event.type === "error") {
          finished = true
          fail(event.message)
        }
      })
      if (!finished) throw new Error("The reply was cut off; try again")
    } catch (err) {
      fail(err instanceof Error ? err.message : "Yomi couldn't reply")
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
      setSettled(0)
      setConfirmReset(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reset the conversation")
    } finally {
      setResetting(false)
    }
  }

  const enter = (i: number) =>
    reduce || i < settled ? false : { opacity: 0, y: 14, scale: 0.96, filter: "blur(6px)" as const }

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
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        >
          {loading ? (
            <ListSkeleton label="loading your conversation" />
          ) : history.length === 0 && !sending ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <motion.div
                initial={reduce ? false : { scale: 0.6, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={SPRING}
                className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"
              >
                <Sparkles size={20} />
              </motion.div>
              <p className="text-base font-semibold text-foreground">say hi to yomi</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                ask anything, or try one of these. it&apos;s the same thread as telegram.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={s}
                    initial={reduce ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: 0.15 + i * 0.07 }}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-foreground/30"
                  >
                    {s}
                  </motion.button>
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
                    <motion.li
                      initial={enter(i)}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      transition={SPRING}
                      style={{ transformOrigin: mine ? "bottom right" : "bottom left" }}
                      className={cn("group flex flex-col", mine ? "items-end" : "items-start")}
                    >
                      <div
                        className={cn(
                          "max-w-[88%] break-words px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
                          mine
                            ? "whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                            : ASSISTANT_BUBBLE,
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
                    </motion.li>
                  </Fragment>
                )
              })}
              <AnimatePresence>
                {live && (
                  <motion.li
                    key="live"
                    initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={SPRING}
                    style={{ transformOrigin: "bottom left" }}
                    className="flex flex-col items-start"
                  >
                    <motion.div
                      layout={!reduce}
                      transition={SPRING}
                      className={cn(
                        "max-w-[88%] break-words px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
                        ASSISTANT_BUBBLE,
                      )}
                    >
                      {shown ? <Formatted text={shown} caret /> : <Status label={live.status} />}
                    </motion.div>
                  </motion.li>
                )}
              </AnimatePresence>
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
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 px-1 text-xs text-destructive"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 shadow-sm transition-[border-color,box-shadow] focus-within:border-foreground/30 focus-within:shadow-md">
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
              placeholder={sending ? "yomi is replying…" : "message yomi"}
              aria-label="message yomi"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            <motion.button
              type="submit"
              disabled={!draft.trim() || sending}
              aria-label="send"
              whileTap={{ scale: 0.85 }}
              animate={{ scale: draft.trim() && !sending ? 1 : 0.9 }}
              transition={SPRING}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
            >
              {sending ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </motion.button>
          </div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            enter to send · shift+enter for a new line
          </p>
        </form>
      </div>
    </section>
  )
}
