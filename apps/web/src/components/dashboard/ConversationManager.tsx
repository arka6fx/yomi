"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai"
import {
  ArrowUp,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Mic,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { PageHeader, SURFACE } from "@/components/dashboard/shell/ui"
import { cn } from "@/lib/utils"
import { ListSkeleton } from "@/components/dashboard/shell/motion"
import { closeOpenMarks, parseMarkdown, type Inline } from "@/lib/chat-markdown"
import { MAX_PHOTOS, isAcceptedImage, photoToDataUrl } from "@/lib/chat-images"
import { useVoiceRecorder } from "@/lib/use-voice-recorder"

type Turn = { role: "user" | "assistant" | "system"; content: string; createdAt?: string | null }

// Messages on the wire follow the Vercel AI SDK's UIMessage. The backend streams a
// transient `data-status` part ("checking your inbox") while a tool runs.
type Meta = { createdAt?: string }
type Data = { status: { label: string; tool?: string } }
type YomiMessage = UIMessage<Meta, Data>

type Attachment = { id: string; name: string; url: string; mediaType: string }

const SUGGESTIONS = [
  "what's on my calendar today?",
  "anything important in my inbox?",
  "remind me at 6pm to call mum",
]

// Telegram messages show up here too; check for new ones while the page is open.
const POLL_MS = 15_000

const SPRING = { type: "spring", stiffness: 380, damping: 30 } as const
const POP = { type: "spring", stiffness: 520, damping: 32 } as const

function toMessages(turns: Turn[]): YomiMessage[] {
  return turns
    .filter((t) => t.role !== "system")
    .map((t, i) => ({
      id: `h${i}-${t.createdAt ?? ""}`,
      role: t.role as "user" | "assistant",
      metadata: { createdAt: t.createdAt ?? undefined },
      parts: [{ type: "text", text: t.content }],
    }))
}

function textOf(message: YomiMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim()
}

function photosOf(message: YomiMessage): FileUIPart[] {
  return message.parts.filter(
    (p): p is FileUIPart => p.type === "file" && p.mediaType.startsWith("image/"),
  )
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

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

/** A live waveform from the recorder's level meter. */
function Waveform({ levels }: { levels: number[] }) {
  return (
    <div className="flex h-8 flex-1 items-center gap-[3px] overflow-hidden" aria-hidden>
      {levels.map((level, i) => (
        <motion.span
          key={i}
          className="w-[3px] shrink-0 rounded-full bg-destructive/80"
          animate={{ height: `${Math.max(12, level * 100)}%` }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
        />
      ))}
    </div>
  )
}

// The one conversation Yomi keeps with you: the same thread as Telegram, so you can
// text from either place and pick up where you left off. Built on the Vercel AI SDK's
// useChat; the backend speaks its UI message stream (/api/conversation/shared/chat).
export function ConversationManager({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [notice, setNotice] = useState("")
  const [resetting, setResetting] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  // Messages already on screen when the page loaded don't animate in.
  const [settled, setSettled] = useState<Set<string>>(new Set())
  const seenAt = useRef(new Map<string, string>())
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const pinned = useRef(true)
  const reduce = useReducedMotion()
  const recorder = useVoiceRecorder()

  const tokenRef = useRef(token)
  tokenRef.current = token
  const transport = useMemo(
    () =>
      new DefaultChatTransport<YomiMessage>({
        api: "/api/conversation/shared/chat",
        headers: () => ({ Authorization: `Bearer ${tokenRef.current}` }),
        // The server keeps the thread; only the new message travels.
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { message: messages[messages.length - 1] },
        }),
      }),
    [],
  )

  const { messages, setMessages, sendMessage, status, stop, error, clearError, regenerate } =
    useChat<YomiMessage>({
      transport,
      experimental_throttle: 40,
      onData: (part) => {
        if (part.type === "data-status") setToolStatus(part.data.label)
      },
      onFinish: () => {
        setToolStatus(null)
        input.current?.focus()
      },
      onError: () => setToolStatus(null),
    })

  const busy = status === "submitted" || status === "streaming"
  const busyRef = useRef(busy)
  busyRef.current = busy

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        const res = await fetch("/api/conversation/shared", {
          headers: { Authorization: `Bearer ${tokenRef.current}` },
        })
        if (!res.ok) throw new Error(`Couldn't load your conversation (${res.status})`)
        const data = (await res.json()) as { history?: Turn[] }
        // A reply in flight owns the thread; don't let a poll overwrite it.
        if (busyRef.current) return
        const loaded = toMessages(data.history ?? [])
        if (quiet) {
          // Only pull in turns that arrived elsewhere (Telegram); keep local photos.
          setMessages((current) => (loaded.length > current.length ? loaded : current))
        } else {
          setMessages(loaded)
          setSettled(new Set(loaded.map((m) => m.id)))
          setLoadError("")
        }
      } catch (err) {
        if (!quiet)
          setLoadError(err instanceof Error ? err.message : "Couldn't load your conversation")
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [setMessages],
  )

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const last = messages[messages.length - 1]
  const liveText = status === "streaming" && last?.role === "assistant" ? textOf(last) : ""
  const shown = useSmoothText(liveText)

  // Follow the newest message, unless you've scrolled up to read something.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages.length, shown, toolStatus, status, loading])

  // The box grows with what you type, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [draft])

  async function addPhotos(files: Iterable<File>) {
    const picked = [...files].filter(isAcceptedImage)
    if (!picked.length) {
      setNotice("add PNG, JPEG, WebP or GIF photos")
      return
    }
    const room = MAX_PHOTOS - attachments.length
    if (room <= 0) {
      setNotice(`up to ${MAX_PHOTOS} photos per message`)
      return
    }
    setNotice(picked.length > room ? `up to ${MAX_PHOTOS} photos per message` : "")
    const ready = await Promise.all(
      picked.slice(0, room).map(async (file) => ({
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        ...(await photoToDataUrl(file)),
      })),
    )
    setAttachments((current) => [...current, ...ready].slice(0, MAX_PHOTOS))
  }

  function send(text: string) {
    const message = text.trim()
    if ((!message && !attachments.length) || busy) return
    pinned.current = true
    setDraft("")
    setNotice("")
    setConfirmReset(false)
    clearError()
    setToolStatus(null)
    const files: FileUIPart[] = attachments.map((a) => ({
      type: "file",
      mediaType: a.mediaType,
      filename: a.name,
      url: a.url,
    }))
    setAttachments([])
    void sendMessage(message ? { text: message, files } : { files })
  }

  async function toggleMic() {
    if (recorder.state === "recording") {
      const { blob, seconds } = await recorder.stop()
      if (!blob) return
      setTranscribing(true)
      setNotice("")
      try {
        const res = await fetch(`/api/conversation/transcribe?seconds=${seconds}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenRef.current}`,
            "Content-Type": blob.type.split(";")[0] || "audio/webm",
          },
          body: blob,
        })
        const data = (await res.json().catch(() => ({}))) as { text?: string; detail?: string }
        if (!res.ok || !data.text) throw new Error(data.detail || "couldn't hear that; try again")
        setDraft((d) => (d.trim() ? `${d.trim()} ${data.text}` : data.text!))
        input.current?.focus()
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "couldn't hear that; try again")
      } finally {
        setTranscribing(false)
      }
      return
    }
    await recorder.start()
  }

  useEffect(() => {
    if (recorder.state === "denied") setNotice("allow the microphone to record a voice note")
    if (recorder.state === "unsupported") setNotice("this browser can't record audio")
  }, [recorder.state])

  async function handleReset() {
    if (!confirmReset) {
      setConfirmReset(true)
      return
    }
    setResetting(true)
    setNotice("")
    try {
      const res = await fetch("/api/conversation/shared/reset", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      })
      if (!res.ok) throw new Error("Couldn't reset the conversation")
      setMessages([])
      setSettled(new Set())
      setConfirmReset(false)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't reset the conversation")
    } finally {
      setResetting(false)
    }
  }

  function stampOf(message: YomiMessage): string | undefined {
    if (message.metadata?.createdAt) return message.metadata.createdAt
    if (!seenAt.current.has(message.id)) seenAt.current.set(message.id, new Date().toISOString())
    return seenAt.current.get(message.id)
  }

  const recording = recorder.state === "recording"
  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !busy
  const action: "stop" | "send" | "mic" = busy ? "stop" : canSend || recording ? "send" : "mic"
  const waitingForWords = busy && !liveText
  const errorText = notice || (error ? error.message || "Yomi couldn't reply" : "")

  const enter = (id: string) =>
    reduce || settled.has(id)
      ? false
      : { opacity: 0, y: 14, scale: 0.96, filter: "blur(6px)" as const }

  return (
    <section className="space-y-6 pt-6">
      <PageHeader
        title="conversation"
        subtitle="text yomi here or on telegram; it's one thread. send photos or a voice note too. start fresh any time and the old one moves to history."
        actions={
          messages.length > 0 && (
            <button
              onClick={handleReset}
              disabled={resetting || busy}
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
          "relative flex h-[calc(100svh-15rem)] min-h-[440px] flex-col overflow-hidden",
        )}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].includes("Files")) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void addPhotos(e.dataTransfer.files)
        }}
      >
        <AnimatePresence>
          {dragging && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-2 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-background/85 text-sm font-medium backdrop-blur-sm"
            >
              <motion.span
                initial={{ scale: 0.6, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={POP}
                className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground"
              >
                <ImagePlus size={22} />
              </motion.span>
              drop photos to send them to yomi
            </motion.div>
          )}
        </AnimatePresence>

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
          ) : loadError ? (
            <p className="py-10 text-center text-sm text-destructive">{loadError}</p>
          ) : messages.length === 0 ? (
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
                ask anything, send a photo, or hold a voice note. it&apos;s the same thread as
                telegram.
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
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs text-foreground transition-colors hover:border-foreground/30"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="space-y-3">
              {messages.map((message, i) => {
                const stamp = stampOf(message)
                const day = dayLabel(stamp)
                const prev = messages[i - 1]
                const showDay = day && day !== dayLabel(prev ? stampOf(prev) : undefined)
                const mine = message.role === "user"
                const streamingThis = !mine && i === messages.length - 1 && status === "streaming"
                const text = textOf(message)
                const photos = photosOf(message)
                if (!mine && !text && streamingThis) return null
                return (
                  <Fragment key={message.id}>
                    {showDay && (
                      <li className="flex justify-center py-1">
                        <span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {day}
                        </span>
                      </li>
                    )}
                    <motion.li
                      initial={enter(message.id)}
                      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                      transition={SPRING}
                      style={{ transformOrigin: mine ? "bottom right" : "bottom left" }}
                      className={cn("group flex flex-col", mine ? "items-end" : "items-start")}
                    >
                      {photos.length > 0 && (
                        <div
                          className={cn(
                            "mb-1.5 grid max-w-[75%] gap-1.5",
                            photos.length > 1 ? "grid-cols-2" : "grid-cols-1",
                          )}
                        >
                          {photos.map((p, j) => (
                            <motion.img
                              key={j}
                              src={p.url}
                              alt={p.filename ?? "photo"}
                              initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ ...POP, delay: j * 0.05 }}
                              className="max-h-56 w-full rounded-2xl object-cover shadow-sm"
                            />
                          ))}
                        </div>
                      )}
                      {(text || !photos.length) && (
                        <motion.div
                          layout={streamingThis && !reduce}
                          transition={SPRING}
                          className={cn(
                            "max-w-[88%] break-words px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]",
                            mine
                              ? "whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary text-primary-foreground"
                              : ASSISTANT_BUBBLE,
                          )}
                        >
                          {mine ? (
                            text
                          ) : streamingThis ? (
                            <Formatted text={shown} caret />
                          ) : (
                            <Formatted text={text} />
                          )}
                        </motion.div>
                      )}
                      <div className="mt-1 flex h-5 items-center gap-1 px-1 text-[11px] text-muted-foreground">
                        <span>{timeLabel(stamp)}</span>
                        {!mine && !streamingThis && text && <CopyButton text={text} />}
                      </div>
                    </motion.li>
                  </Fragment>
                )
              })}
              <AnimatePresence>
                {waitingForWords && (
                  <motion.li
                    key="status"
                    initial={reduce ? false : { opacity: 0, y: 14, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.1 } }}
                    transition={SPRING}
                    style={{ transformOrigin: "bottom left" }}
                    className="flex flex-col items-start"
                  >
                    <div className={cn("px-4 py-2.5 text-sm", ASSISTANT_BUBBLE)}>
                      <Status label={toolStatus} />
                    </div>
                  </motion.li>
                )}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (recording) void toggleMic()
            else send(draft)
          }}
          className="border-t border-border/60 p-3 sm:p-4"
        >
          <AnimatePresence>
            {errorText && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 flex items-center gap-2 px-1 text-xs text-destructive"
              >
                <span>{errorText}</span>
                {error && !notice && (
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    retry
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div
            layout={!reduce}
            transition={SPRING}
            className={cn(
              "rounded-2xl border bg-background px-2.5 py-2 shadow-sm transition-[border-color,box-shadow]",
              recording
                ? "border-destructive/40 shadow-[0_0_0_4px_rgba(239,68,68,0.08)]"
                : "border-border focus-within:border-foreground/30 focus-within:shadow-md",
            )}
          >
            <AnimatePresence initial={false}>
              {attachments.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 px-0.5 pb-2 pt-0.5">
                    <AnimatePresence mode="popLayout">
                      {attachments.map((a) => (
                        <motion.div
                          key={a.id}
                          layout
                          initial={{ opacity: 0, scale: 0.6, rotate: -6 }}
                          animate={{ opacity: 1, scale: 1, rotate: 0 }}
                          exit={{ opacity: 0, scale: 0.6 }}
                          transition={POP}
                          className="group/chip relative size-16 shrink-0"
                        >
                          <img
                            src={a.url}
                            alt={a.name}
                            className="size-full rounded-xl object-cover ring-1 ring-border"
                          />
                          <button
                            type="button"
                            aria-label={`remove ${a.name}`}
                            onClick={() => setAttachments((c) => c.filter((x) => x.id !== a.id))}
                            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow"
                          >
                            <X size={11} strokeWidth={3} />
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex items-end gap-1.5">
              <input
                ref={filePicker}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void addPhotos(e.target.files)
                  e.target.value = ""
                }}
              />
              <AnimatePresence initial={false} mode="popLayout">
                {!recording && (
                  <motion.button
                    key="attach"
                    type="button"
                    aria-label="attach photos"
                    onClick={() => filePicker.current?.click()}
                    disabled={busy || attachments.length >= MAX_PHOTOS}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    whileTap={{ scale: 0.85 }}
                    transition={POP}
                    className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  >
                    <ImagePlus size={17} />
                  </motion.button>
                )}
              </AnimatePresence>

              <AnimatePresence initial={false} mode="wait">
                {recording ? (
                  <motion.div
                    key="recording"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="flex min-h-9 flex-1 items-center gap-3 px-1"
                    aria-live="polite"
                  >
                    <motion.span
                      className="size-2.5 shrink-0 rounded-full bg-destructive"
                      animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    />
                    <span className="w-9 shrink-0 text-xs font-medium tabular-nums text-destructive">
                      {clock(recorder.seconds)}
                    </span>
                    <Waveform levels={recorder.levels} />
                    <button
                      type="button"
                      onClick={recorder.cancel}
                      className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      cancel
                    </button>
                  </motion.div>
                ) : (
                  <motion.textarea
                    key="text"
                    ref={input}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={(e) => {
                      const files = [...e.clipboardData.files].filter(isAcceptedImage)
                      if (files.length) {
                        e.preventDefault()
                        void addPhotos(files)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault()
                        send(draft)
                      }
                    }}
                    rows={1}
                    maxLength={4000}
                    disabled={transcribing}
                    placeholder={
                      transcribing ? "listening back…" : busy ? "yomi is replying…" : "message yomi"
                    }
                    aria-label="message yomi"
                    className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                )}
              </AnimatePresence>

              <motion.button
                type={action === "stop" ? "button" : action === "mic" ? "button" : "submit"}
                onClick={
                  action === "stop"
                    ? () => void stop()
                    : action === "mic"
                      ? () => void toggleMic()
                      : undefined
                }
                disabled={transcribing}
                aria-label={
                  action === "stop"
                    ? "stop"
                    : action === "mic"
                      ? "record a voice note"
                      : recording
                        ? "finish recording"
                        : "send"
                }
                whileTap={{ scale: 0.85 }}
                whileHover={{ scale: 1.06 }}
                transition={POP}
                className={cn(
                  "relative grid size-9 shrink-0 place-items-center rounded-full text-primary-foreground shadow-sm transition-colors disabled:opacity-50",
                  action === "mic" && !recording
                    ? "bg-foreground/85"
                    : recording
                      ? "bg-destructive"
                      : "bg-primary",
                )}
              >
                {recording && !reduce && (
                  <motion.span
                    className="absolute inset-0 rounded-full bg-destructive"
                    animate={{ scale: [1, 1.6], opacity: [0.45, 0] }}
                    transition={{ duration: 1.3, repeat: Infinity, ease: "easeOut" }}
                  />
                )}
                <AnimatePresence initial={false} mode="wait">
                  <motion.span
                    key={transcribing ? "wait" : recording ? "done" : action}
                    initial={{ scale: 0.4, opacity: 0, rotate: -45 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.4, opacity: 0, rotate: 45 }}
                    transition={{ duration: 0.16 }}
                    className="relative grid place-items-center"
                  >
                    {transcribing ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : recording ? (
                      <ArrowUp size={17} />
                    ) : action === "stop" ? (
                      <Square size={12} className="fill-current" />
                    ) : action === "mic" ? (
                      <Mic size={16} />
                    ) : (
                      <ArrowUp size={17} />
                    )}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.div>
          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            enter to send · shift+enter for a new line · paste or drop photos · tap the mic for a
            voice note
          </p>
        </form>
      </div>
    </section>
  )
}
