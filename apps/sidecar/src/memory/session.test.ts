import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as loader from "./loader.js"
import * as session from "./session.js"

let tempDir = ""

describe("local memory session helpers", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-memory-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
  })

  afterEach(async () => {
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("initializes the current ~/.yomi directory shape", async () => {
    await loader.initMemoryDir()

    expect(await readdir(join(tempDir, "projects"))).toEqual([])
    expect(await readdir(join(tempDir, "sessions"))).toEqual([])
  })

  it("returns empty strings for missing memory files", async () => {
    expect(await loader.loadMemorySummary()).toBe("")
    expect(await loader.loadMemoryIndex()).toBe("")
  })

  it("appends a sanitized session turn without media payloads", async () => {
    await session.appendSessionTurn({
      kind: "fast",
      mode: "answer",
      input: "what is this?",
      output: "It is a settings screen.",
    })

    const today = new Date().toISOString().slice(0, 10)
    const log = await readFile(join(tempDir, "sessions", `${today}-dev.md`), "utf-8")
    expect(log).toContain("fast/answer")
    expect(log).toContain("what is this?")
    expect(log).toContain("It is a settings screen.")
    expect(log).not.toContain("screenshot_b64")
    expect(log).not.toContain("audio_b64")
  })

  it("loads the recent tail of today's session log", async () => {
    await session.appendSessionTurn({
      kind: "fast",
      input: "remember my project name",
      output: "Your project is Yomi.",
    })

    const recent = await session.loadRecentSession()

    expect(recent).toContain("remember my project name")
    expect(recent).toContain("Your project is Yomi.")
  })

  it("remember adds durable memory and skips exact duplicates", async () => {
    await session.remember("tone", "Arkady prefers concise answers.")
    await session.remember("tone", "Arkady prefers concise answers.")

    const memory = await readFile(join(tempDir, "memory.md"), "utf-8")
    expect(memory.match(/Arkady prefers concise answers/g)?.length).toBe(1)
  })

  it("forget removes matching memory lines", async () => {
    await writeFile(
      join(tempDir, "memory.md"),
      "# Long-term memory\n\n- tone: Arkady prefers concise answers.\n- city: Arkady is in Pune.\n",
      "utf-8",
    )

    const removed = await session.forget("concise")
    const memory = await readFile(join(tempDir, "memory.md"), "utf-8")

    expect(removed).toBe(1)
    expect(memory).not.toContain("concise")
    expect(memory).toContain("Pune")
  })
})
