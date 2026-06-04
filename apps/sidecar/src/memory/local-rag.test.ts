import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { closeLocalRag, indexLocalRagSources, retrieveLocalRagContext } from "./local-rag.js"

let tempDir = ""

describe("local RAG memory index", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-local-rag-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    await mkdir(join(tempDir, "sessions"), { recursive: true })
    await mkdir(join(tempDir, "projects", "yomi"), { recursive: true })
    await mkdir(join(tempDir, "memory"), { recursive: true })
  })

  afterEach(async () => {
    closeLocalRag()
    delete process.env["YOMI_NOTEPAD_DIR"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("indexes sessions and project memory files", async () => {
    await writeFile(
      join(tempDir, "sessions", "2026-05-26-dev.md"),
      "User discussed local-rag-saffron retrieval for Yomi.",
      "utf-8",
    )
    await writeFile(
      join(tempDir, "projects", "yomi", "context.md"),
      "Yomi project uses local memory RAG for historical decisions.",
      "utf-8",
    )

    await indexLocalRagSources()
    const context = await retrieveLocalRagContext("local-rag-saffron historical decisions")

    expect(context).toContain("sessions/2026-05-26-dev.md")
    expect(context).toContain("projects/yomi/context.md")
    expect(context).toContain("local-rag-saffron")
  })

  it("does not index personal profile files as RAG documents", async () => {
    await writeFile(
      join(tempDir, "memory", "profile.static.md"),
      "Arkady prefers paprika memory answers.",
      "utf-8",
    )
    await writeFile(
      join(tempDir, "memory", "long-project-note.md"),
      "The archive includes turmeric project notes.",
      "utf-8",
    )

    const context = await retrieveLocalRagContext("paprika turmeric")

    expect(context).not.toContain("profile.static.md")
    expect(context).not.toContain("paprika")
    expect(context).toContain("memory/long-project-note.md")
    expect(context).toContain("turmeric")
  })

  it("caps returned snippets by maxChars", async () => {
    await writeFile(
      join(tempDir, "sessions", "2026-05-26-dev.md"),
      `needle ${"long memory ".repeat(80)}`,
      "utf-8",
    )

    const context = await retrieveLocalRagContext("needle", 80)

    expect(context.length).toBeLessThanOrEqual(80)
  })
})
