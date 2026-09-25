import type { ReactNode } from "react"

// Shared look for dashboard pages: big lowercase title, one-line subtitle, and
// soft rounded "surface" cards instead of bordered boxes.
export const SURFACE =
  "rounded-[1.75rem] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_28px_rgba(20,40,80,0.06)]"

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{title}</h1>
        {subtitle && <p className="mt-3 max-w-xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
