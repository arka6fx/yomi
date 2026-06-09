import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createCronJobTool } from "./cronjob-tool.js"
import type { Plan } from "@yomi/shared"

let tmpBase: string
const sharedTool = createCronJobTool({ plan: "pro" as Plan })

beforeEach(async () => {
  tmpBase = join(tmpdir(), "yomi-cronjob-test", Math.random().toString(36).slice(2))
  await mkdir(tmpBase, { recursive: true })
  process.env["YOMI_NOTEPAD_DIR"] = tmpBase
})

afterEach(async () => {
  await rm(tmpBase, { recursive: true, force: true })
  delete process.env["YOMI_NOTEPAD_DIR"]
})

async function execute(action: string, args: Record<string, unknown> = {}) {
  const tool = sharedTool["cronjob"]
  return tool.execute!({ action, ...args }, { toolCallId: "test", messages: [] })
}

describe("cronjob tool — create", () => {
  it("creates a job with schedule and prompt", async () => {
    const result = await execute("create", { schedule: "30m", prompt: "run test" })
    expect(result.ok).toBe(true)
    expect(result.id).toBeDefined()
    expect(result.scheduleType).toBe("duration")
  })

  it("rejects missing schedule", async () => {
    const result = await execute("create", { prompt: "test" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("schedule")
  })

  it("rejects missing prompt", async () => {
    const result = await execute("create", { schedule: "30m" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("prompt")
  })

  it("rejects invalid schedule format", async () => {
    const result = await execute("create", { schedule: "invalid", prompt: "test" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("unrecognised")
  })

  it("creates ISO schedule as oneShot", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    const result = await execute("create", { schedule: future, prompt: "future test" })
    expect(result.ok).toBe(true)
  })

  it("rejects create when plan is explore", async () => {
    const exploreTool = createCronJobTool({ plan: "explore" as Plan })
    const result = await exploreTool["cronjob"]!.execute!(
      { action: "create", schedule: "30m", prompt: "test" },
      { toolCallId: "test", messages: [] },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Pro feature")
  })
})

describe("cronjob tool — list", () => {
  it("returns empty list when no jobs", async () => {
    const result = await execute("list")
    expect(result.ok).toBe(true)
    expect(result.count).toBe(0)
    expect(result.jobs).toEqual([])
  })

  it("lists created jobs", async () => {
    await execute("create", { schedule: "1h", prompt: "job one" })
    await execute("create", { schedule: "2h", prompt: "job two" })

    const result = await execute("list")
    expect(result.ok).toBe(true)
    expect(result.count).toBe(2)
  })
})

describe("cronjob tool — view", () => {
  it("views a specific job", async () => {
    const created = await execute("create", { schedule: "30m", prompt: "viewable" })
    const result = await execute("view", { id: created.id })
    expect(result.ok).toBe(true)
    expect(result.job.prompt).toBe("viewable")
  })

  it("rejects view for missing id", async () => {
    const result = await execute("view", {})
    expect(result.ok).toBe(false)
    expect(result.error).toContain("id is required")
  })

  it("rejects view for nonexistent job", async () => {
    const result = await execute("view", { id: "nonexistent" })
    expect(result.ok).toBe(false)
    expect(result.error).toContain("not found")
  })
})

describe("cronjob tool — update", () => {
  it("updates a job's prompt and schedule", async () => {
    const created = await execute("create", { schedule: "30m", prompt: "original" })
    const result = await execute("update", { id: created.id, prompt: "updated prompt", schedule: "1h" })
    expect(result.ok).toBe(true)
    expect(result.updated.prompt).toBe("updated prompt")
    expect(result.updated.schedule).toBe("1h")
  })

  it("rejects update for missing id", async () => {
    const result = await execute("update", { prompt: "test" })
    expect(result.ok).toBe(false)
  })
})

describe("cronjob tool — delete", () => {
  it("deletes an existing job", async () => {
    const created = await execute("create", { schedule: "30m", prompt: "deletable" })
    const result = await execute("delete", { id: created.id })
    expect(result.ok).toBe(true)
    expect(result.deleted).toBe(true)

    const list = await execute("list")
    expect(list.count).toBe(0)
  })

  it("rejects delete for missing id", async () => {
    const result = await execute("delete", {})
    expect(result.ok).toBe(false)
  })
})

describe("cronjob tool — pause / resume", () => {
  it("pauses a job", async () => {
    const created = await execute("create", { schedule: "30m", prompt: "pausable" })
    const paused = await execute("pause", { id: created.id })
    expect(paused.ok).toBe(true)
    expect(paused.enabled).toBe(false)
  })

  it("resumes a paused job", async () => {
    const created = await execute("create", { schedule: "30m", prompt: "resumable" })
    await execute("pause", { id: created.id })
    const resumed = await execute("resume", { id: created.id })
    expect(resumed.ok).toBe(true)
    expect(resumed.enabled).toBe(true)
  })

  it("rejects pause for nonexistent job", async () => {
    const result = await execute("pause", { id: "ghost" })
    expect(result.ok).toBe(false)
  })
})

describe("cronjob tool — entitlement for explore plan", () => {
  it("blocks list for explore", async () => {
    const exploreTool = createCronJobTool({ plan: "explore" as Plan })
    const result = await exploreTool["cronjob"]!.execute!(
      { action: "list" },
      { toolCallId: "test", messages: [] },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain("Pro feature")
  })
})
