"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"

type Line = { from: "yomi" | "you"; text: string }

// Short scenes that play one after another. Anything that would send, book or pay
// ends at an approval, the same as the real bot.
const SCENES: Line[][] = [
  [
    { from: "yomi", text: "it’s 9pm. you said you’d finish the deck today 👀" },
    { from: "you", text: "i know 😭 block 2 hours tomorrow?" },
    { from: "yomi", text: "9–11am, no meetings then. tap approve and it’s on your calendar ✅" },
  ],
  [
    { from: "yomi", text: "morning ☀️ 3 meetings, 2 emails need you, psych essay due friday" },
    { from: "you", text: "draft the replies pls" },
    { from: "yomi", text: "both drafted. nothing sends till you approve 👍" },
  ],
  [
    { from: "you", text: "what did i spend on food this month?" },
    { from: "yomi", text: "₹6,240 across 18 receipts, up 12% on last month 🍜" },
    { from: "you", text: "ok remind me sunday to meal prep" },
    { from: "yomi", text: "done. sunday 11am 🥦" },
  ],
]

const TYPING_MS = 900
const USER_MS = 1100
const HOLD_MS = 2800

export function AutoThread({ start = 0 }: { start?: number }) {
  const reduce = useReducedMotion()
  const [scene, setScene] = useState(start % SCENES.length)
  const [shown, setShown] = useState(0)
  const [typing, setTyping] = useState(false)
  const lines = SCENES[scene]!

  useEffect(() => {
    if (reduce) {
      setShown(lines.length)
      return
    }
    let t: ReturnType<typeof setTimeout>
    if (shown < lines.length) {
      const next = lines[shown]!
      if (next.from === "yomi" && !typing) {
        t = setTimeout(() => setTyping(true), 250)
      } else {
        t = setTimeout(
          () => {
            setTyping(false)
            setShown((n) => n + 1)
          },
          next.from === "yomi" ? TYPING_MS : USER_MS,
        )
      }
    } else {
      t = setTimeout(() => {
        setShown(0)
        setScene((s) => (s + 1) % SCENES.length)
      }, HOLD_MS)
    }
    return () => clearTimeout(t)
  }, [shown, typing, lines, reduce])

  return (
    <div aria-hidden className="flex h-[232px] w-full max-w-sm flex-col justify-end gap-2.5">
      <AnimatePresence initial={false} mode="popLayout">
        {lines.slice(0, shown).map((line, i) => (
          <motion.p
            key={`${scene}-${i}`}
            layout
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={`w-fit max-w-[82%] px-4 py-2.5 text-[15px] font-medium ${
              line.from === "you"
                ? "bubble-out ml-auto origin-bottom-right"
                : "bubble-in origin-bottom-left"
            }`}
          >
            {line.text}
          </motion.p>
        ))}
        {typing && (
          <motion.span
            key="typing"
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bubble-in flex w-fit gap-1 px-4 py-3.5"
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                style={{ animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}
