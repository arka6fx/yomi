"use client"

import { useId } from "react"
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

function YomiMark({ className = "" }: { className?: string }) {
  const uid = useId().replace(/:/g, "")
  const bgId = `ym-bg-${uid}`
  const shineId = `ym-shine-${uid}`

  return (
    <svg
      viewBox="-3 -3 30 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect x="-3" y="-3" width="30" height="30" rx="7" fill={`url(#${bgId})`} />
      <rect x="-3" y="-3" width="30" height="11" rx="7" fill={`url(#${shineId})`} />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill="white"
        d="M12 2c-.791 0-1.55.314-2.11.874l-.893.893a.985.985 0 0 1-.696.288H7.04A2.984 2.984 0 0 0 4.055 7.04v1.262a.986.986 0 0 1-.288.696l-.893.893a2.984 2.984 0 0 0 0 4.22l.893.893a.985.985 0 0 1 .288.696v1.262a2.984 2.984 0 0 0 2.984 2.984h1.262c.261 0 .512.104.696.288l.893.893a2.984 2.984 0 0 0 4.22 0l.893-.893a.985.985 0 0 1 .696-.288h1.262a2.984 2.984 0 0 0 2.984-2.984V15.7c0-.261.104-.512.288-.696l.893-.893a2.984 2.984 0 0 0 0-4.22l-.893-.893a.985.985 0 0 1-.288-.696V7.04a2.984 2.984 0 0 0-2.984-2.984h-1.262a.985.985 0 0 1-.696-.288l-.893-.893A2.984 2.984 0 0 0 12 2Zm3.683 7.73a1 1 0 1 0-1.414-1.413l-4.253 4.253-1.277-1.277a1 1 0 0 0-1.415 1.414l1.985 1.984a1 1 0 0 0 1.414 0l4.96-4.96Z"
      />
      <defs>
        <linearGradient id={bgId} x1="-3" y1="-3" x2="27" y2="27" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B5BDB" />
        </linearGradient>
        <linearGradient id={shineId} x1="0" y1="-3" x2="0" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.2" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}

export function BrandMark({ withText = true, size = "md", className = "" }: BrandMarkProps) {
  return (
    <Link href="/" className={`inline-flex items-center gap-2.5 select-none ${className}`} aria-label="Yomi home">
      <YomiMark className={`${sizes[size]} shadow-[0_0_18px_rgba(96,165,250,0.30)]`} />
      {withText && <span className="font-display text-xl font-bold text-foreground">Yomi</span>}
    </Link>
  )
}
