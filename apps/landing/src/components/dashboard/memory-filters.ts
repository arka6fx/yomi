import type { MemoryRow } from "./memory-types"

export type MemoryFilters = {
  kind: string | null
  scope: string | null
  pinnedOnly: boolean
}

export function matchesMemoryFilter(memory: MemoryRow, filters: MemoryFilters): boolean {
  if (filters.kind && memory.kind !== filters.kind) return false
  if (filters.scope && memory.scope !== filters.scope) return false
  if (filters.pinnedOnly && !memory.isStatic) return false
  return true
}
