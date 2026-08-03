import { describe, expect, it } from "bun:test"
import { matchesMemoryFilter, type MemoryFilters } from "./memory-filters"
import type { MemoryRow } from "./memory-types"

const noFilter: MemoryFilters = { kind: null, scope: null, pinnedOnly: false }

function makeMemory(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "m1",
    topic: "Test topic",
    kind: "fact",
    scope: "global",
    content: "Test content",
    summary: null,
    isStatic: false,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  }
}

describe("matchesMemoryFilter", () => {
  it("matches everything when no filters are set", () => {
    expect(matchesMemoryFilter(makeMemory(), noFilter)).toBe(true)
  })

  it("matches when kind filter equals the memory's kind", () => {
    const memory = makeMemory({ kind: "preference" })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "preference" })).toBe(true)
  })

  it("excludes when kind filter does not equal the memory's kind", () => {
    const memory = makeMemory({ kind: "fact" })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "preference" })).toBe(false)
  })

  it("matches when scope filter equals the memory's scope", () => {
    const memory = makeMemory({ scope: "project" })
    expect(matchesMemoryFilter(memory, { ...noFilter, scope: "project" })).toBe(true)
  })

  it("excludes when scope filter does not equal the memory's scope", () => {
    const memory = makeMemory({ scope: "global" })
    expect(matchesMemoryFilter(memory, { ...noFilter, scope: "project" })).toBe(false)
  })

  it("excludes a non-pinned memory when pinnedOnly is true", () => {
    const memory = makeMemory({ isStatic: false })
    expect(matchesMemoryFilter(memory, { ...noFilter, pinnedOnly: true })).toBe(false)
  })

  it("includes a pinned memory when pinnedOnly is true", () => {
    const memory = makeMemory({ isStatic: true })
    expect(matchesMemoryFilter(memory, { ...noFilter, pinnedOnly: true })).toBe(true)
  })

  it("requires every active filter to match (combination)", () => {
    const memory = makeMemory({ kind: "fact", scope: "global", isStatic: true })
    expect(matchesMemoryFilter(memory, { kind: "fact", scope: "global", pinnedOnly: true })).toBe(
      true,
    )
    expect(matchesMemoryFilter(memory, { kind: "fact", scope: "project", pinnedOnly: true })).toBe(
      false,
    )
  })

  it("treats a memory with no kind as not matching a specific kind filter", () => {
    const memory = makeMemory({ kind: null })
    expect(matchesMemoryFilter(memory, { ...noFilter, kind: "fact" })).toBe(false)
  })
})
