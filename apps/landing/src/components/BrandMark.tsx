"use client"

import Link from "next/link"

type BrandMarkProps = {
  withText?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizes = {
  sm: "size-10",
  md: "size-12",
  lg: "size-16",
}

export function BrandMark({ withText = true, size = "md", className = "" }: BrandMarkProps) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
      aria-label="Yomi home"
    >
      <img
        // 128x128 covers the largest rendered size (lg, 64px) at 2x without
        // shipping the full 192x192 icon file for a 48px header mark
        src="/brand-mark-128.png"
        alt=""
        className={`${sizes[size]} rounded-[22%]`}
        width={48}
        height={48}
      />
      {withText && (
        <span
          className="text-2xl font-bold leading-none text-foreground font-handwriting"
          style={{ WebkitTextStroke: "0.6px currentColor" }}
        >
          Yomi
        </span>
      )}
    </Link>
  )
}
