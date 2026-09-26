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

/** Shimmering rows (icon + two lines) standing in for a list while it loads. */
export function ListSkeleton({ rows = 3, label = "loading" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-4 py-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, n) => (
        <div key={n} className="flex items-center gap-3">
          <div className="shimmer size-9 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-1.5">
            <div className="shimmer h-3.5 w-2/5 rounded-full" />
            <div className="shimmer h-3 w-3/4 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** A card-shaped placeholder (picture + lines) for pages that load as one card. */
export function CardSkeleton({ label = "loading" }: { label?: string }) {
  return (
    <div
      className="rounded-[1.75rem] bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)] sm:p-6"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex items-center gap-4">
        <div className="shimmer size-16 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="shimmer h-4 w-1/3 rounded-full" />
          <div className="shimmer h-3 w-1/2 rounded-full" />
        </div>
      </div>
      <div className="mt-6 space-y-3">
        <div className="shimmer h-10 rounded-xl" />
        <div className="shimmer h-10 rounded-xl" />
      </div>
    </div>
  )
}

/** A pulsing placeholder with a light sweep, shown while a section loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skel", className)} />
}
