"use client"

import { motion } from "framer-motion"
import { Sparkles } from "lucide-react"

export function DocsHero() {
  return (
    <header className="relative overflow-hidden border-b border-border">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 120% at 50% -10%, hsl(var(--primary) / 0.18), transparent 60%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(50% 80% at 85% 10%, hsl(280 70% 60% / 0.12), transparent 65%)",
        }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-16 text-center sm:py-20">
        <motion.span
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-primary"
        >
          <Sparkles size={11} />
          Documentation
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="mt-5 text-5xl font-semibold tracking-[-0.04em] sm:text-6xl"
        >
          Everything Yomi does, <span className="text-brand">today</span>.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.16 }}
          className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground"
        >
          A complete, honest map of what&apos;s shipped: the Telegram bot, every app connector,
          memory, voice, and how the free and Pro plans work.
        </motion.p>
      </div>
    </header>
  )
}
