"use client"

import { cn } from "@/lib/utils"
import { DOCS_INDEX } from "./docs-search"

export function DocsToc({ activeId }: { activeId: string | null }) {
  return (
    <nav aria-label="On this page" className="space-y-3">
      <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/90">
        On this page
      </p>
      <div className="space-y-0.5">
        {DOCS_INDEX.map((entry) => (
          <a
            key={entry.id}
            href={`#${entry.id}`}
            className={cn(
              "block rounded-lg px-3 py-1 text-[13px] transition-colors",
              activeId === entry.id
                ? "font-medium text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.title}
          </a>
        ))}
      </div>
    </nav>
  )
}
