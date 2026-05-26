import { describe, expect, it } from "bun:test"
import { buildFastPrompt } from "./prompt.js"
import { closeMemorySubsystem, loadMemoryContext } from "../memory/subsystem.js"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("prompt memory injection", () => {
  it("includes memory summary and index when provided", () => {
    const prompt = buildFastPrompt({
      yomiMd: "User likes direct answers.",
      memorySummary: "- Arkady is building Yomi.",
      memoryIndex: "sessions/2026-05-25-dev.md - memory work",
      recentSession: "User: remember my project\nAssistant: It is Yomi.",
    })

    expect(prompt).toContain("<memory>")
    expect(prompt).toContain("Arkady is building Yomi")
    expect(prompt).toContain("memory work")
    expect(prompt).toContain("<recent_chat>")
    expect(prompt).toContain("remember my project")
  })

  it("instructs responses to render final answers in blocks", () => {
    const prompt = buildFastPrompt({})

    expect(prompt).toContain("<answer_format>")
    expect(prompt).toContain("```answer")
    expect(prompt).toContain("For coding or algorithm problems")
    expect(prompt).toContain("Format applications and letters properly")
    expect(prompt).toContain("Format biographies and long explanations")
  })

  it("caps loaded memory context", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "yomi-prompt-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    try {
      await writeFile(join(tempDir, "memory.md"), "a".repeat(5000), "utf-8")
      await writeFile(join(tempDir, "memory-index.md"), "b".repeat(3000), "utf-8")

      const ctx = await loadMemoryContext("memory")

      expect(ctx.memorySummary.length).toBe(4000)
      expect(ctx.memoryIndex.length).toBe(2000)
    } finally {
      closeMemorySubsystem()
      delete process.env["YOMI_NOTEPAD_DIR"]
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
