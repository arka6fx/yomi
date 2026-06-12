"use client"

import Link from "next/link"

type BrandMarkProps = {
  withText?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizes = {
  sm: "size-7",
  md: "size-9",
  lg: "size-12",
}

export function BrandMark({ withText = true, size = "md", className = "" }: BrandMarkProps) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2.5 select-none ${className}`}
      aria-label="Yomi home"
    >
      <img
        src="/android-chrome-192x192.png"
        alt=""
        className={`${sizes[size]} rounded-[22%] shadow-[0_0_18px_rgba(96,165,250,0.30)]`}
        width={48}
        height={48}
      />
      {withText && <span className="font-display text-xl font-bold text-foreground">Yomi</span>}
    </Link>
  )
}
