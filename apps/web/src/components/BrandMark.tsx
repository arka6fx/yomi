import Link from "next/link"

type BrandMarkProps = {
  withText?: boolean
  size?: "sm" | "md" | "lg"
  className?: string
}

const sizes = {
  sm: { img: "size-8", text: "text-xl" },
  md: { img: "size-10", text: "text-[1.7rem]" },
  lg: { img: "size-14", text: "text-4xl" },
}

export function BrandMark({ withText = true, size = "md", className = "" }: BrandMarkProps) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-2 select-none ${className}`}
      aria-label="Yomi home"
    >
      <img
        // 128x128 covers the largest rendered size (lg, 56px) at 2x
        src="/brand-mark-128.png"
        alt=""
        className={`${sizes[size].img} object-contain drop-shadow-[0_3px_4px_rgba(16,24,40,0.25)]`}
        width={48}
        height={48}
      />
      {withText && (
        <span
          className={`${sizes[size].text} font-bold leading-none tracking-[-0.04em] text-foreground`}
        >
          yomi
        </span>
      )}
    </Link>
  )
}
