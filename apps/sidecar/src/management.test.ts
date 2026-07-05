import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendTurn } from "./memory/chat-history.js"
import {
  addMemory,
  forgetMemory,
  getDiagnostics,
  listSchedules,
  listSessions,
  removeSchedule,
  removeSessionTurn,
  searchMemories,
  setScheduleEnabled,
  upsertSchedule,
} from "./management.js"

const originalFetch = globalThis.fetch
let tempDir = ""

mock.module("./tools/cron/cron-scheduler.js", () => ({
  getDefaultScheduler: () => ({ start: () => {}, stop: () => {} }),
}))

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-management-"))
  process.env["YOMI_SIDECAR_DATA_DIR"] = tempDir
  process.env["YOMI_SESSION_TOKEN"] = "test-token"
  process.env["YOMI_BACKEND_URL"] = "http://backend.test"
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url)
    if (path.endsWith("/api/memory/search")) {
      expect(init?.method).toBe("POST")
      return Response.json({
        memories: [
          {
            id: "m1",
            content: "likes concise updates",
            kind: "preference",
            scope: "global",
            topic: "Style",
            confidence: 90,
          },
        ],
      })
    }
    if (path.endsWith("/api/memory/add")) {
      return Response.json({
        memory: {
          id: "m2",
          content: "new memory",
          kind: "fact",
          scope: "global",
          topic: "Fact",
          confidence: 80,
        },
      })
    }
    if (path.endsWith("/api/memory/forget")) {
      return Response.json({ forgotten: 1, ids: ["m1"] })
    }
    return Response.json({ memories: [] })
  }
})

afterEach(async () => {
  globalThis.fetch = originalFetch
  delete process.env["YOMI_SIDECAR_DATA_DIR"]
  delete process.env["YOMI_SESSION_TOKEN"]
  delete process.env["YOMI_BACKEND_URL"]
  if (tempDir) await removeTempDir(tempDir)
})

async function removeTempDir(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(path, { recursive: true, force: true })
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EBUSY") throw err
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

describe("management sessions", () => {
  it("lists, searches, and deletes local chat turns", async () => {
    await appendTurn({
      id: 1,
      transcript: "find invoice",
      text: "Invoice summary",
      timestamp: "2026-01-01T00:00:00.000Z",
    })
    await appendTurn({
      id: 2,
      transcript: "calendar",
      text: "Calendar summary",
      timestamp: "2026-01-01T00:01:00.000Z",
    })

    expect(await listSessions({ query: "invoice" })).toHaveLength(1)
    expect(await removeSessionTurn(1)).toBe(true)
    expect(await listSessions()).toHaveLength(1)
  })
})

describe("management schedules", () => {
  it("creates, toggles, and deletes schedules", async () => {
    const created = await upsertSchedule({ schedule: "every day 9am", prompt: "summarize email" })
    expect(created.enabled).toBe(true)
    expect(await listSchedules()).toHaveLength(1)

    const paused = await setScheduleEnabled(created.id, false)
    expect(paused?.enabled).toBe(false)

    expect(await removeSchedule(created.id)).toBe(true)
    expect(await listSchedules()).toHaveLength(0)
  })
})

describe("management memories", () => {
  it("proxies cloud memory search, add, and forget", async () => {
    const found = await searchMemories("style")
    expect(found[0]?.id).toBe("m1")

    const added = await addMemory({ content: "new memory" })
    expect(added.id).toBe("m2")

    const forgotten = await forgetMemory("m1")
    expect(forgotten.forgotten).toBe(1)
  })
})

describe("management diagnostics", () => {
  it("summarizes local runtime state", async () => {
    await appendTurn({
      id: 1,
      transcript: "hello",
      text: "hi",
      timestamp: "2026-01-01T00:00:00.000Z",
    })
    await upsertSchedule({ schedule: "30m", prompt: "check status" })

    const diagnostics = await getDiagnostics()
    expect(diagnostics.status).toBe("ok")
    expect(diagnostics.sessions.turns).toBe(1)
    expect(diagnostics.cron.jobs).toBe(1)
    expect(diagnostics.env.sessionTokenPresent).toBe(true)
  })
})

describe("management routes", () => {
  it("serves schedules through the sidecar HTTP boundary", async () => {
    const app = (await import("./index.js")).default

    const create = await app.fetch(
      new Request("http://sidecar.test/management/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sidecar-secret": process.env["SIDECAR_SECRET"] ?? "",
        },
        body: JSON.stringify({ schedule: "30m", prompt: "check inbox" }),
      }),
    )
    expect(create.status).toBe(200)
    const created = (await create.json()) as { schedule?: { id: string } }
    expect(created.schedule?.id).toStartWith("cron-")

    const list = await app.fetch(
      new Request("http://sidecar.test/management/schedules", {
        headers: { "x-sidecar-secret": process.env["SIDECAR_SECRET"] ?? "" },
      }),
    )
    expect(list.status).toBe(200)
    const data = (await list.json()) as { schedules?: unknown[] }
    expect(data.schedules).toHaveLength(1)
  })
})
