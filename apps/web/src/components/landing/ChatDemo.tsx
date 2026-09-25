"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowRight, Mic, Plus } from "lucide-react"

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

  return (
    <div className="relative mx-auto h-[min(700px,calc(100dvh-10.5rem))] w-[min(360px,calc(100vw-2rem))] rounded-[3rem] bg-[#16181d] p-2.5 shadow-[0_40px_80px_rgba(10,20,40,0.45)]">
      <div className="flex h-full flex-col overflow-hidden rounded-[2.4rem] bg-[#f7f8fa]">
        <div className="flex items-center justify-between px-7 pt-3 text-[13px] font-semibold text-[#16181d]">
          <span>9:41</span>
          <span className="h-6 w-24 rounded-full bg-[#16181d]" aria-hidden />
          <span aria-hidden>●●●</span>
        </div>

        <div className="flex flex-col items-center gap-1 border-b border-black/5 pb-3 pt-2">
          <img
            src="/brand-mark-128.png"
            alt=""
            width={44}
            height={44}
            className="size-11 rounded-full"
          />
          <span className="rounded-full bg-white px-3 py-0.5 text-sm font-semibold text-[#16181d] shadow-sm">
            Yomi
          </span>
        </div>

        <div
          ref={scroller}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4"
          aria-live="polite"
          aria-label="Conversation with Yomi"
        >
          <p className="pb-1 text-center text-[11px] text-[#8a909c]">Today</p>
          {bubbles.map((bubble, index) => (
            <div key={index} className={bubble.from === "you" ? "flex justify-end" : "flex"}>
              <p
                className={
                  bubble.from === "you"
                    ? "max-w-[85%] rounded-[1.25rem] rounded-br-md bg-[#2b8fff] px-3.5 py-2 text-[15px] text-white"
                    : "max-w-[85%] rounded-[1.25rem] rounded-bl-md bg-[#e7e9ee] px-3.5 py-2 text-[15px] text-[#16181d]"
                }
              >
                {bubble.text}
              </p>
            </div>
          ))}

          {typing && (
            <div className="flex" aria-label="Yomi is typing">
              <span className="flex gap-1 rounded-[1.25rem] rounded-bl-md bg-[#e7e9ee] px-4 py-3">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-1.5 animate-bounce rounded-full bg-[#8a909c]"
                    style={{ animationDelay: `${i * 0.12}s` }}
                  />
                ))}
              </span>
            </div>
          )}

          {stage === "pick" && (
            <div
              role="group"
              aria-label="What should Yomi help with?"
              className="flex flex-wrap justify-end gap-1.5 pt-1"
            >
              {TOPICS.map((topic) => {
                const on = picked.includes(topic.id)
                return (
                  <button
                    key={topic.id}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(topic.id)}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition ${
                      on
                        ? "border-[#2b8fff] bg-[#2b8fff] text-white"
                        : "border-black/10 bg-white text-[#16181d] hover:bg-[#f1f3f6]"
                    }`}
                  >
                    {topic.label}
                  </button>
                )
              })}
              {picked.length > 0 && (
                <button
                  onClick={submit}
                  className="inline-flex items-center gap-1 rounded-full bg-[#16181d] px-3.5 py-1.5 text-[13px] font-semibold text-white"
                >
                  that’s it <ArrowRight size={13} />
                </button>
              )}
            </div>
          )}

          {stage === "done" && (
            <div className="flex justify-center pt-2">
              <Link href="/signup" className="btn-telegram px-5 py-3 text-sm">
                Continue with Telegram <ArrowRight size={15} />
              </Link>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-3 pb-5 pt-2">
          <span
            className="grid size-8 place-items-center rounded-full bg-[#e7e9ee] text-[#5b6270]"
            aria-hidden
          >
            <Plus size={16} />
          </span>
          <span className="flex flex-1 items-center justify-between rounded-full border border-black/10 bg-white px-4 py-2 text-sm text-[#8a909c]">
            {stage === "pick" ? "pick as many as you like" : "Message"}
            <Mic size={15} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  )
}
