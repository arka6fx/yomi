"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  AppWindow,
  ArrowLeft,
  ArrowUpRight,
  BatteryFull,
  Check,
  CheckCheck,
  EllipsisVertical,
  Mic,
  Paperclip,
  SignalHigh,
  Smile,
  Wifi,
} from "lucide-react"

type Topic = { id: string; label: string; reply: string }

// Every reply describes something Yomi actually does today.
const TOPICS: Topic[] = [
  {
    id: "inbox",
    label: "📬 my inbox",
    reply:
      "i’ll flag the emails that matter and draft replies. nothing sends till you tap approve.",
  },
  {
    id: "calendar",
    label: "📅 my calendar",
    reply: "i’ll move meetings, find free time and send you a morning brief at 8.",
  },
  {
    id: "money",
    label: "💸 money",
    reply:
      "your cards stay in an encrypted vault with a monthly limit. every payment needs your ok.",
  },
  {
    id: "receipts",
    label: "🧾 receipts",
    reply: "forward receipts to your own yomi email and i’ll log what you spent.",
  },
  {
    id: "travel",
    label: "✈️ travel",
    reply: "i’ll compare options, save the bookings and remind you before you leave.",
  },
  {
    id: "shopping",
    label: "🛒 shopping",
    reply: "i’ll research, compare prices and fill checkout on my own computer, then wait for you.",
  },
  {
    id: "habits",
    label: "✅ habits & reminders",
    reply: "tell me when, i’ll check in on schedule. no app to open.",
  },
  {
    id: "study",
    label: "📚 study",
    reply: "i’ll track deadlines from classroom and nudge you before they sneak up.",
  },
  {
    id: "work",
    label: "💼 work",
    reply: "github, slack, notion, linear. ask me and i’ll do it across all of them.",
  },
  {
    id: "people",
    label: "🤝 people",
    reply: "i can message the yomi of people you trust to sort out plans for you.",
  },
]

const INTRO = [
  "hey, i’m yomi 👋",
  "i live in your telegram",
  "so what should i take off your plate?",
]

type Bubble = { from: "yomi" | "you"; text: string }

// Telegram's dark theme, with the purple outgoing bubbles from a real yomi chat.
const TG = {
  bg: "#0e1621",
  bar: "#17212b",
  incoming: "#182533",
  outgoing: "linear-gradient(135deg, #8a4fe8 0%, #7440d8 100%)",
  accent: "#5eb5f7",
  muted: "#7f91a4",
}

// Faint doodles tiled behind the chat, like Telegram's default wallpaper.
const WALLPAPER = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' fill='none' stroke='#fff' stroke-opacity='0.05' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M14 20l4-8 4 8-8-5h8z'/><circle cx='70' cy='18' r='7'/><path d='M100 40c6 0 6 8 0 8s-6 8 0 8'/><rect x='12' y='64' width='16' height='12' rx='3'/><path d='M16 64v-3h8v3'/><path d='M58 70l8 8m0-8l-8 8'/><path d='M92 88a8 8 0 1 0 12 0l-6-10z'/><path d='M30 100h14M37 93v14'/><path d='M66 104c4-6 10-6 14 0'/></svg>`,
)}")`

function Tick({ read }: { read: boolean }) {
  return read ? <CheckCheck size={14} aria-hidden /> : <Check size={14} aria-hidden />
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  }, [])
  return reduced
}

export function ChatDemo() {
  const reduced = useReducedMotion()
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [typing, setTyping] = useState(false)
  const [stage, setStage] = useState<"intro" | "pick" | "answer" | "done">("intro")
  const [picked, setPicked] = useState<string[]>([])
  const scroller = useRef<HTMLDivElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Play Yomi's messages one by one with a typing indicator between them.
  function say(lines: string[], then: () => void) {
    const gap = reduced ? 0 : 900
    lines.forEach((line, index) => {
      timers.current.push(
        setTimeout(() => setTyping(true), index * gap),
        setTimeout(
          () => {
            setTyping(false)
            setBubbles((current) => [...current, { from: "yomi", text: line }])
            if (index === lines.length - 1) then()
          },
          index * gap + (reduced ? 0 : 650),
        ),
      )
    })
  }

  useEffect(() => {
    setBubbles([])
    setStage("intro")
    say(INTRO, () => setStage("pick"))
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.length = 0
    }
    // Replays only when the reduced-motion preference resolves.
  }, [reduced])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [bubbles, typing, stage])

  function toggle(id: string) {
    setPicked((current) =>
      current.includes(id) ? current.filter((p) => p !== id) : [...current, id],
    )
  }

  function submit() {
    const chosen = TOPICS.filter((topic) => picked.includes(topic.id))
    if (chosen.length === 0) return
    setStage("answer")
    setBubbles((current) => [
      ...current,
      { from: "you", text: chosen.map((t) => t.label).join("  ") },
    ])
    say(
      [
        chosen.length > 1 ? "love that. here’s the plan:" : "gotchu.",
        ...chosen.slice(0, 3).map((topic) => topic.reply),
        "ready? tap below and i’ll text you on telegram",
      ],
      () => setStage("done"),
    )
  }

  const time = "9:41 AM"
  const pickHint = picked.length ? `${picked.length} picked` : "pick as many as you like"

  return (
    <div className="relative mx-auto h-[min(700px,calc(100dvh-10.5rem))] w-[min(360px,calc(100vw-2rem))] rounded-[3rem] bg-[#16181d] p-2.5 shadow-[0_40px_80px_rgba(10,20,40,0.45)]">
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-[2.4rem] text-white"
        style={{ backgroundColor: TG.bg, backgroundImage: WALLPAPER }}
      >
        {/* status bar */}
        <div
          className="flex items-center justify-between px-7 pb-1 pt-3 text-[13px] font-semibold"
          style={{ background: TG.bar }}
        >
          <span>9:41</span>
          <span className="h-6 w-24 rounded-full bg-black" aria-hidden />
          <span className="flex items-center gap-1" aria-hidden>
            <SignalHigh size={14} />
            <Wifi size={14} />
            <BatteryFull size={16} />
          </span>
        </div>

        {/* chat header */}
        <div
          className="flex items-center gap-3 px-3 pb-2.5 pt-1.5 shadow-[0_1px_0_rgba(0,0,0,0.35)]"
          style={{ background: TG.bar }}
        >
          <ArrowLeft size={20} className="shrink-0 text-white/90" aria-hidden />
          <img
            src="/brand-mark-128.png"
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-full"
          />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[15px] font-semibold">yomi</p>
            <p className="text-[13px]" style={{ color: typing ? TG.accent : TG.muted }}>
              {typing ? "typing…" : "bot"}
            </p>
          </div>
          <EllipsisVertical size={20} className="shrink-0 text-white/80" aria-hidden />
        </div>

        <div
          ref={scroller}
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 py-3 [scrollbar-width:none]"
          aria-live="polite"
          aria-label="Conversation with Yomi"
        >
          <p className="flex justify-center pb-1.5">
            <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[12px] font-medium text-white/85">
              Today
            </span>
          </p>
          {bubbles.map((bubble, index) => {
            const mine = bubble.from === "you"
            const last = bubbles[index + 1]?.from !== bubble.from
            return (
              <div key={index} className={mine ? "flex justify-end" : "flex"}>
                <p
                  className={`relative max-w-[82%] rounded-2xl px-3 pb-1.5 pt-1.5 text-[14.5px] leading-snug shadow-[0_1px_1px_rgba(0,0,0,0.25)] ${
                    last ? (mine ? "rounded-br-[4px]" : "rounded-bl-[4px]") : ""
                  }`}
                  style={{ background: mine ? TG.outgoing : TG.incoming }}
                >
                  {bubble.text}
                  <span
                    className={`float-right ml-2 mt-1.5 inline-flex translate-y-0.5 items-center gap-0.5 text-[11px] ${
                      mine ? "text-white/75" : ""
                    }`}
                    style={mine ? undefined : { color: TG.muted }}
                  >
                    {time}
                    {mine && <Tick read={index < bubbles.length - 1 || typing} />}
                  </span>
                </p>
              </div>
            )
          })}

          {/* the topic picker is a Telegram inline keyboard under yomi's last message */}
          {stage === "pick" && (
            <div
              role="group"
              aria-label="What should Yomi help with?"
              className="grid max-w-[92%] grid-cols-2 gap-1 pt-0.5"
            >
              {TOPICS.map((topic) => {
                const on = picked.includes(topic.id)
                return (
                  <button
                    key={topic.id}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(topic.id)}
                    className={`truncate rounded-lg px-2 py-2 text-[13px] font-medium backdrop-blur-sm transition-colors ${
                      on ? "bg-[#7440d8]/80" : "bg-white/[0.09] hover:bg-white/[0.14]"
                    }`}
                  >
                    {on ? "✓ " : ""}
                    {topic.label}
                  </button>
                )
              })}
              {picked.length > 0 && (
                <button
                  onClick={submit}
                  className="col-span-2 rounded-lg py-2 text-[13px] font-semibold text-white"
                  style={{ background: TG.accent }}
                >
                  that’s it →
                </button>
              )}
            </div>
          )}

          {stage === "done" && (
            <div className="max-w-[92%] pt-0.5">
              <Link
                href="/signup"
                className="flex items-center justify-center gap-1 rounded-lg bg-white/[0.09] py-2 text-[13px] font-semibold hover:bg-white/[0.14]"
              >
                open yomi on telegram <ArrowUpRight size={14} />
              </Link>
            </div>
          )}
        </div>

        {/* composer: the bot's menu button, then the message field */}
        <div className="flex items-center gap-1.5 px-2 pb-5 pt-2" style={{ background: TG.bar }}>
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] font-semibold"
            style={{ background: "#3390ec" }}
            aria-hidden
          >
            <AppWindow size={14} /> Dashboard
          </span>
          <span
            className="flex min-w-0 flex-1 items-center gap-2 px-1.5 text-[14px]"
            style={{ color: TG.muted }}
          >
            <Smile size={18} className="shrink-0" aria-hidden />
            <span className="truncate">{stage === "pick" ? pickHint : "Message"}</span>
          </span>
          <Paperclip size={18} className="shrink-0" style={{ color: TG.muted }} aria-hidden />
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full"
            style={{ background: "#3390ec" }}
            aria-hidden
          >
            <Mic size={17} />
          </span>
        </div>
      </div>
    </div>
  )
}
