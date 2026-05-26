import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir: string

mock.module("ai", () => ({
  tool: (definition: unknown) => definition,
  jsonSchema: (schema: unknown) => schema,
  generateObject: async () => ({ object: {} }),
  generateText: async () => ({
    text: JSON.stringify({
      memories: [
        {
          kind: "preference",
          scope: "global",
          topic: "package manager",
          content: "User prefers Bun for Yomi development.",
          confidence: 0.9,
        },
      ],
    }),
  }),
  streamText: () => ({
    textStream: (async function* () {
      yield "ok"
    })(),
  }),
}))

mock.module("../pipeline/model.js", () => ({
  createModel: () => "mock-model",
}))

const engine = await import("./engine.js")

describe("local memory engine", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-memory-engine-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
  })

  afterEach(async () => {
    engine.closeMemoryEngine()
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("extracts a durable memory and retrieves it with local FTS", async () => {
    await engine.captureTurnMemory({
      input: "Remember that I prefer Bun for this project.",
      output: "Got it.",
    })

    const context = engine.retrieveLocalMemoryContext("which package manager should yomi use?")

    expect(context).toContain("package manager")
    expect(context).toContain("Bun")
  })

  it("forgets matching local memories", async () => {
    await engine.captureTurnMemory({
      input: "Remember that I prefer Bun for this project.",
      output: "Got it.",
    })

    const removed = await engine.forgetLocalMemory("package manager")
    const context = engine.retrieveLocalMemoryContext("package manager")

    expect(removed).toBeGreaterThan(0)
    expect(context).not.toContain("Bun")
  })

  it("handles hyphenated query terms safely", async () => {
    await engine.captureTurnMemory({
      input: "Remember that I prefer Bun for this project.",
      output: "Got it.",
    })

    const context = engine.retrieveLocalMemoryContext("package-manager")

    expect(context).toContain("Bun")
  })
})
