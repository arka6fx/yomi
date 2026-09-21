import { describe, expect, it } from "vitest"
import { chunkMarkdown } from "./index.js"

describe("chunkMarkdown", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(chunkMarkdown("")).toEqual([])
    expect(chunkMarkdown("   \n\n  ")).toEqual([])
  })

  it("packs small paragraphs into a single chunk", () => {
    const chunks = chunkMarkdown("# Title\n\nFirst paragraph.\n\nSecond paragraph.", {
      targetChars: 1000,
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain("# Title")
    expect(chunks[0]).toContain("First paragraph.")
    expect(chunks[0]).toContain("Second paragraph.")
  })

  it("splits on paragraph boundaries when over the target", () => {
    const content = "Alpha paragraph one.\n\nBeta paragraph two.\n\nGamma paragraph three."
    const chunks = chunkMarkdown(content, { targetChars: 30, overlap: 5 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.trim().length).toBeGreaterThan(0)
  })

  it("hard-splits a single oversized paragraph", () => {
    const huge = "word ".repeat(400).trim() // ~2000 chars, no blank lines
    const chunks = chunkMarkdown(huge, { targetChars: 500, overlap: 50 })
    expect(chunks.length).toBeGreaterThan(1)
    // No chunk should vastly exceed the window (allow overlap slack).
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500 + 50 + 10)
  })
})
