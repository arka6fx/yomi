import { afterEach, describe, expect, it } from "bun:test"
import { closeMemorySubsystem, initMemorySubsystem, loadMemoryContext } from "./subsystem.js"

const realFetch = globalThis.fetch
const realToken = process.env["YOMI_SESSION_TOKEN"]

afterEach(() => {
  globalThis.fetch = realFetch
  if (realToken === undefined) delete process.env["YOMI_SESSION_TOKEN"]
  else process.env["YOMI_SESSION_TOKEN"] = realToken
})

describe("memory subsystem", () => {
  it("initializes without local markdown or sqlite state", async () => {
    await initMemorySubsystem()
    closeMemorySubsystem()
  })

  it("returns backend-memory bundle fields and reads recent session history", async () => {
    const ctx = await loadMemoryContext("anything")

    expect(ctx.memorySummary).toBe("")
    expect(ctx.memoryIndex).toBe("")
    expect(ctx.durableMemory).toBe("")
    expect(ctx.localMemory).toBe("")
    expect(ctx.cloudRagContext).toBe("")
    expect(ctx.staticProfile).toBe("")
    expect(ctx.dynamicProfile).toBe("")
    expect(typeof ctx.recentSession).toBe("string")
  })

  it("loads static and dynamic profile context from backend memory", async () => {
    process.env["YOMI_SESSION_TOKEN"] = "session_1"
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/memory/profile")) {
        return new Response(JSON.stringify({ profile: { static: ["Prefers TypeScript"], dynamic: ["Working on Yomi memory"] } }), { status: 200 })
      }
      return new Response(JSON.stringify({ memories: [], snippets: [] }), { status: 200 })
    }) as typeof fetch

    const ctx = await loadMemoryContext("memory")
    expect(ctx.staticProfile).toContain("Prefers TypeScript")
    expect(ctx.dynamicProfile).toContain("Working on Yomi memory")
  })
})
