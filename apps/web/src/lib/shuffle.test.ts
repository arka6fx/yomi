import { describe, expect, it } from "vitest"
import { shuffled } from "./shuffle"

describe("shuffled", () => {
  it("keeps every item exactly once and leaves the input alone", () => {
    const input = Array.from({ length: 50 }, (_, i) => i)
    const out = shuffled(input)
    expect([...out].sort((a, b) => a - b)).toEqual(input)
    expect(input).toEqual(Array.from({ length: 50 }, (_, i) => i))
  })

  it("actually reorders", () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    expect(shuffled([1, 2, 3, 4, 5, 6, 7, 8], random)).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it("handles empty and single lists", () => {
    expect(shuffled([])).toEqual([])
    expect(shuffled(["a"])).toEqual(["a"])
  })
})
