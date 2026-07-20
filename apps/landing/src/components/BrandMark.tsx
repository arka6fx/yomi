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
        src="/android-chrome-192x192.png"
        alt=""
        className={`${sizes[size]} rounded-[22%]`}
        width={48}
        height={48}
      />
      {withText && (
        <span className="font-sans text-2xl font-bold leading-none text-foreground">Yomi</span>
      )}
    </Link>
  )
}
