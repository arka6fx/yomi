import { describe, expect, it } from "bun:test"
import { humanizeDashes } from "./index.js"

describe("humanizeDashes", () => {
  it("replaces a spaced em dash with a comma", () => {
    expect(humanizeDashes("fast — simple")).toBe("fast, simple")
  })

  it("replaces an en dash the same way", () => {
    expect(humanizeDashes("2 – 3 items")).toBe("2, 3 items")
  })

  it("collapses surrounding spaces around the dash", () => {
    expect(humanizeDashes("a —b")).toBe("a, b")
    expect(humanizeDashes("a—  b")).toBe("a, b")
  })

  it("leaves hyphen-minus, arrows, and bullets untouched", () => {
    expect(humanizeDashes("a - b")).toBe("a - b")
    expect(humanizeDashes("x -> y")).toBe("x -> y")
    expect(humanizeDashes("- bullet")).toBe("- bullet")
    expect(humanizeDashes("well-known")).toBe("well-known")
  })

  it("is idempotent", () => {
    const once = humanizeDashes("fast — simple — done")
    expect(humanizeDashes(once)).toBe(once)
  })
})
