import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""
let generateCalls = 0
let generatedText = ""

mock.module("ai", () => ({
  generateText: async () => {
    generateCalls++
    return { text: generatedText }
  },
  streamText: () => ({
    textStream: (async function* () {
      yield "Hello"
    })(),
  }),
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown) => schema,
}))

mock.module("@ai-sdk/openai", () => ({
  createOpenAI: () => (modelId: string) => ({ provider: "openai", modelId }),
}))

import { compact } from "./compactor.js"

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

describe("memory compactor", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-compact-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    generateCalls = 0
    generatedText = `## Recent context (${todayISO()})\n- User prefers concise answers.`
    await mkdir(join(tempDir, "sessions"), { recursive: true })
  })

  afterEach(async () => {
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("skips short session logs", async () => {
    await writeFile(join(tempDir, "sessions", `${todayISO()}-dev.md`), "too short", "utf-8")

    await compact()

    expect(generateCalls).toBe(0)
    expect(await Bun.file(join(tempDir, "memory.md")).exists()).toBe(false)
  })

  it("appends new memory from a meaningful session log", async () => {
    await writeFile(
      join(tempDir, "sessions", `${todayISO()}-dev.md`),
      "User asked about Yomi memory. ".repeat(12),
      "utf-8",
    )

    await compact()

    const memory = await readFile(join(tempDir, "memory.md"), "utf-8")
    const index = await readFile(join(tempDir, "memory-index.md"), "utf-8")
    expect(memory).toContain("User prefers concise answers.")
    expect(index).toContain(`sessions/${todayISO()}-dev.md`)
  })

  it("does not compact the same day twice", async () => {
    await writeFile(
      join(tempDir, "sessions", `${todayISO()}-dev.md`),
      "User asked about Yomi memory. ".repeat(12),
      "utf-8",
    )
    await writeFile(
      join(tempDir, "memory.md"),
      `# Long-term memory\n\n## Recent context (${todayISO()})\n- Existing.\n`,
      "utf-8",
    )

    await compact()

    expect(generateCalls).toBe(0)
  })
})
