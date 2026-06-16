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
    await writeFile(
      join(tempDir, "memory.md"),
      `# Long-term memory\n\n${"a".repeat(5000)}\n`,
      "utf-8",
    )
    await writeFile(join(tempDir, "memory-index.md"), "b".repeat(3000), "utf-8")
    await writeFile(
      join(tempDir, "sessions", `${todayISO()}-dev.md`),
      "User asked about the memory subsystem.",
      "utf-8",
    )
    await writeFile(
      join(tempDir, "memory", "profile.static.md"),
      "Static profile summary.",
      "utf-8",
    )
    await writeFile(
      join(tempDir, "memory", "profile.dynamic.md"),
      "Dynamic profile summary.",
      "utf-8",
    )
  })

  afterEach(async () => {
    closeMemorySubsystem()
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("loads the combined memory context bundle with all 7 fields", async () => {
    const ctx = await loadMemoryContext("memory subsystem")

    expect(ctx.memorySummary.length).toBe(4000)
    expect(ctx.memoryIndex.length).toBe(2000)
    expect(ctx.recentSession).toContain("User asked about the memory subsystem.")
    expect(ctx.staticProfile).toContain("Static profile summary.")
    expect(ctx.dynamicProfile).toContain("Dynamic profile summary.")
    // localMemory and cloudRagContext are FTS/embedding-dependent
    // — may be empty strings in a bare test environment, but the keys must exist
    expect(ctx).toHaveProperty("localMemory")
    expect(ctx).toHaveProperty("cloudRagContext")
  })

  it("returns empty strings for all fields when no files exist", async () => {
    // Clean up created files and re-init
    closeMemorySubsystem()
    await rm(tempDir, { recursive: true, force: true })
    tempDir = await mkdtemp(join(tmpdir(), "yomi-memory-empty-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    await initMemorySubsystem()

    const ctx = await loadMemoryContext("anything")

    expect(ctx.memorySummary).toBe("")
    expect(ctx.memoryIndex).toBe("")
    expect(ctx.localMemory).toBe("")
    expect(ctx.cloudRagContext).toBe("")
    expect(ctx.staticProfile).toBe("")
    expect(ctx.dynamicProfile).toBe("")
    expect(ctx.recentSession).toBe("")
  })

  it("truncates long memory fields to their caps", async () => {
    closeMemorySubsystem()
    await rm(tempDir, { recursive: true, force: true })
    tempDir = await mkdtemp(join(tmpdir(), "yomi-memory-caps-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    await initMemorySubsystem()
    await writeFile(join(tempDir, "memory.md"), "x".repeat(10_000), "utf-8")
    await writeFile(join(tempDir, "memory-index.md"), "y".repeat(5_000), "utf-8")
    await writeFile(join(tempDir, "memory", "profile.static.md"), "z".repeat(5_000), "utf-8")

    const ctx = await loadMemoryContext("caps")

    expect(ctx.memorySummary.length).toBeLessThanOrEqual(4000)
    expect(ctx.memoryIndex.length).toBeLessThanOrEqual(2000)
    expect(ctx.staticProfile.length).toBeLessThanOrEqual(3000)
  })
})
