import { beforeEach, describe, expect, it } from "bun:test"
import { buildGraphSystemPrompt, __resetPromptCacheForTest } from "../prompts.js"

// Note: loadYomiMd reads from ~/.yomi/yomi.md (real user homedir).
// loadMemoryContext reads from the YOMI_NOTEPAD_DIR / YOMI_MEMORY_DIR.
// This test verifies the structural contract: Pro plan loads memory fields,
// Explore plan skips them. Exact content depends on the test environment's
// memory subsystem state and may be mocked by other test suites.

describe("graph memory node", () => {
  beforeEach(() => {
    __resetPromptCacheForTest()
  })

  it("buildGraphSystemPrompt returns a systemPrompt with memory tags for Pro plan", async () => {
    const built = await buildGraphSystemPrompt("what is my project?", "pro")

    expect(built.systemPrompt).toBeTruthy()
    expect(built.systemPrompt.length).toBeGreaterThan(500)
    // Memory fields should be present in the prompt
    expect(built.systemPrompt).toContain("<memory>")
    expect(built.memoryRefs.length).toBeGreaterThan(0)
  })

  it("buildGraphSystemPrompt returns empty memoryRefs for Explore plan", async () => {
    const built = await buildGraphSystemPrompt("what is my project?", "explore")

    expect(built.systemPrompt).toBeTruthy()
    expect(built.memoryRefs).toEqual([])
    expect(built.systemPrompt).not.toContain("<local_retrieved>")
  })

  it("buildGraphSystemPrompt returns memoryRefs listing non-empty fields for Max plan", async () => {
    const built = await buildGraphSystemPrompt("test query", "max")

    expect(built.memoryRefs).toBeInstanceOf(Array)
    for (const ref of built.memoryRefs) {
      expect(typeof ref).toBe("string")
      expect(ref.length).toBeGreaterThan(0)
    }
  })

  it("buildGraphSystemPrompt includes yomi.md user context when available", async () => {
    const built = await buildGraphSystemPrompt("hello", "pro")

    expect(built.systemPrompt).toContain("<user_context>")
  })

  it("buildGraphSystemPrompt prompt structure is valid for the execution pipeline", async () => {
    const built = await buildGraphSystemPrompt("do something", "max")

    expect(built.systemPrompt).toContain("<identity>")
    expect(built.systemPrompt).toContain("<capabilities>")
    expect(built.systemPrompt).toContain("<memory>")
    expect(built.systemPrompt).toContain("<rules>")
  })
})
