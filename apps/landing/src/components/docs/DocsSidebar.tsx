"use client"

import { cn } from "@/lib/utils"
import { DOCS_INDEX, matchesQuery, type DocsGroup } from "./docs-search"

const GROUPS: DocsGroup[] = ["Getting Started", "Capabilities", "Account"]

export function DocsSidebar({
  activeId,
  query,
  onNavigate,
}: {
  activeId: string | null
  query: string
  onNavigate?: () => void
}) {
  const matches = DOCS_INDEX.filter((entry) => matchesQuery(entry, query))

  if (matches.length === 0) {
    return (
      <p className="px-3 py-1.5 text-sm text-muted-foreground">
        No results for &ldquo;{query}&rdquo;
      </p>
    )
  }

  return (
    <nav aria-label="Docs sections" className="space-y-5">
      {GROUPS.map((group) => {
        const entries = matches.filter((entry) => entry.group === group)
        if (entries.length === 0) return null

        return (
          <div key={group}>
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
              {group}
            </p>
            <div className="mt-1.5 space-y-0.5">
              {entries.map((entry) => (
                <a
                  key={entry.id}
                  href={`#${entry.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 text-sm transition-colors",
                    activeId === entry.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {entry.title}
                </a>
              ))}
            </div>
          </div>
        )
      })}
    </nav>
  )
}
