import { describe, expect, it } from "bun:test"
import { STARTER_PROMPTS } from "./starter-prompts.js"

describe("STARTER_PROMPTS", () => {
  it("has at least one connector entry", () => {
    expect(Object.keys(STARTER_PROMPTS).length).toBeGreaterThan(0)
  })

  it("every entry is a non-empty array of non-empty, trimmed strings", () => {
    for (const [id, prompts] of Object.entries(STARTER_PROMPTS)) {
      expect(prompts.length, `${id} has no prompts`).toBeGreaterThan(0)
      expect(prompts.length, `${id} has more than 2 prompts`).toBeLessThanOrEqual(2)
      for (const p of prompts) {
        expect(p.trim().length, `${id} has an empty/whitespace prompt`).toBeGreaterThan(0)
        expect(p, `${id} prompt should not be pre-quoted`).not.toMatch(/^".*"$/)
      }
    }
  })

  it("has no duplicate prompts within a single connector", () => {
    for (const [id, prompts] of Object.entries(STARTER_PROMPTS)) {
      expect(new Set(prompts).size, `${id} has duplicate prompts`).toBe(prompts.length)
    }
  })
})
