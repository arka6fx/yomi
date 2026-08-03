"use client"

import { Pin } from "lucide-react"
import { KINDS, SCOPES } from "./memory-types"
import type { MemoryFilters } from "./memory-filters"

export function MemoryFilterBar({
  filters,
  onChange,
}: {
  filters: MemoryFilters
  onChange: (filters: MemoryFilters) => void
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        value={filters.kind ?? ""}
        onChange={(e) => onChange({ ...filters, kind: e.target.value || null })}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
      >
        <option value="">All kinds</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {k.replace("_", " ")}
          </option>
        ))}
      </select>
      <select
        value={filters.scope ?? ""}
        onChange={(e) => onChange({ ...filters, scope: e.target.value || null })}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
      >
        <option value="">All scopes</option>
        {SCOPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button
        onClick={() => onChange({ ...filters, pinnedOnly: !filters.pinnedOnly })}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          filters.pinnedOnly
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border text-foreground hover:bg-muted"
        }`}
      >
        <Pin size={12} />
        Pinned only
      </button>
    </div>
  )
}
