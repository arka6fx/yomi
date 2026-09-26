"use client"

import { useRef } from "react"
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion"

// Words brighten one by one as the paragraph scrolls through the viewport.
// `*word*` marks a word to set in the brand colour.
const TEXT =
  "most assistants wait for you to open an app. yomi lives where you already *talk.* it *remembers* what you told it, *checks in* when things slip, and does the boring parts across your apps. and it never sends, books, pays or deletes anything until *you* say so."

const WORDS = TEXT.split(" ").map((raw) => ({
  word: raw.replaceAll("*", ""),
  accent: raw.startsWith("*"),
}))

function Word({
  word,
  accent,
  progress,
  range,
}: {
  word: string
  accent: boolean
  progress: MotionValue<number>
  range: [number, number]
}) {
  const opacity = useTransform(progress, range, [0.14, 1])
  return (
    <motion.span style={{ opacity }} className={accent ? "text-brand" : undefined}>
      {word}{" "}
    </motion.span>
  )
}

export function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.5"] })

  return (
    <p
      ref={ref}
      className="mx-auto max-w-4xl text-balance text-center text-3xl font-semibold leading-[1.2] tracking-[-0.035em] sm:text-5xl"
    >
      {WORDS.map(({ word, accent }, i) =>
        reduce ? (
          <span key={i} className={accent ? "text-brand" : undefined}>
            {word}{" "}
          </span>
        ) : (
          <Word
            key={i}
            word={word}
            accent={accent}
            progress={scrollYProgress}
            range={[i / WORDS.length, (i + 1) / WORDS.length]}
          />
        ),
      )}
    </p>
  )
}
