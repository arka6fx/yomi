import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { performCloudRagSync } from "./cloud-rag.js"

let tempDir = ""
const realFetch = globalThis.fetch

describe("cloud RAG sync", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "yomi-cloud-rag-"))
    process.env["YOMI_NOTEPAD_DIR"] = tempDir
    process.env["YOMI_SESSION_TOKEN"] = "test-token"
    process.env["YOMI_BACKEND_URL"] = "http://backend.test"
    await mkdir(join(tempDir, "sessions"), { recursive: true })
  })

  afterEach(async () => {
    globalThis.fetch = realFetch
    delete process.env["YOMI_NOTEPAD_DIR"]
    delete process.env["YOMI_SESSION_TOKEN"]
    delete process.env["YOMI_BACKEND_URL"]
    await rm(tempDir, { recursive: true, force: true })
  })

  it("compares remote mirror paths instead of display names when detecting deletes", async () => {
    await writeFile(
      join(tempDir, "sessions", "2026-05-26-dev.md"),
      "Cloud mirror should keep this archive source.",
      "utf-8",
    )

    const posted: Array<{ removedPaths?: string[] }> = []
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input.toString()
      if (url.endsWith("/api/rag/sources")) {
        return new Response(
          JSON.stringify({
            sources: [
              {
                id: "source_1",
                name: "2026-05-26-dev.md",
                path: "sessions/2026-05-26-dev.md",
                sourceType: "mirror",
                status: "ready",
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.endsWith("/api/rag/sync")) {
        posted.push(JSON.parse(String(init?.body ?? "{}")) as { removedPaths?: string[] })
        return new Response(JSON.stringify({ synced: 1, removed: 0 }), { status: 200 })
      }
      return new Response("{}", { status: 404 })
    }) as typeof fetch

    await performCloudRagSync()

    expect(posted[0]?.removedPaths).toEqual([])
  })
})
