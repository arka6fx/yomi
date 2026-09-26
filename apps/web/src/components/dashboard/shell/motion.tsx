"use client"

import { motion, useReducedMotion } from "framer-motion"
import { cn } from "@/lib/utils"

// Dashboard sections arrive blurred and slightly low, then settle: the transform
// springs into place while opacity and blur ease in, one section after another.
const EASE = [0.32, 0.72, 0, 1] as const

export function Reveal({
  i = 0,
  className,
  children,
}: {
  /** position in the page; each step starts 0.14s after the one before */
  i?: number
  className?: string
  children: React.ReactNode
}) {
  const reduce = useReducedMotion()
  if (reduce) return <div className={className}>{children}</div>
  const delay = i * 0.14
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: "blur(14px)", y: 16, scale: 0.985 }}
      animate={{ opacity: 1, filter: "blur(0px)", y: 0, scale: 1 }}
      transition={{
        y: { type: "spring", stiffness: 170, damping: 26, delay },
        scale: { type: "spring", stiffness: 170, damping: 26, delay },
        opacity: { duration: 0.6, ease: EASE, delay },
        filter: { duration: 0.6, ease: EASE, delay },
      }}
    >
      {children}
    </motion.div>
  )
}

/** A pulsing placeholder with a light sweep, shown while a section loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skel", className)} />
}
