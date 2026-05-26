import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeMemorySubsystem, initMemorySubsystem, loadMemoryContext } from "./subsystem.js"

let tempDir = ""

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

describe("memory subsystem", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-memory-subsystem-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    await initMemorySubsystem()
    await writeFile(join(tempDir, "memory.md"), `# Long-term memory\n\n${"a".repeat(5000)}\n`, "utf-8")
    await writeFile(join(tempDir, "memory-index.md"), "b".repeat(3000), "utf-8")
    await writeFile(join(tempDir, "sessions", `${todayISO()}-dev.md`), "User asked about the memory subsystem.", "utf-8")
    await writeFile(join(tempDir, "memory", "profile.static.md"), "Static profile summary.", "utf-8")
    await writeFile(join(tempDir, "memory", "profile.dynamic.md"), "Dynamic profile summary.", "utf-8")
  })

  afterEach(async () => {
    closeMemorySubsystem()
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("loads the combined memory context bundle", async () => {
    const ctx = await loadMemoryContext("memory subsystem")

    expect(ctx.memorySummary.length).toBe(4000)
    expect(ctx.memoryIndex.length).toBe(2000)
    expect(ctx.recentSession).toContain("User asked about the memory subsystem.")
    expect(ctx.staticProfile).toContain("Static profile summary.")
    expect(ctx.dynamicProfile).toContain("Dynamic profile summary.")
  })
})
