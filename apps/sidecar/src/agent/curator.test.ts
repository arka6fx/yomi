import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LanguageModelV1 } from "ai"

let tempDir = ""
let generatedText = ""

mock.module("ai", () => ({
  generateText: async () => ({ text: generatedText }),
  streamText: () => ({
    textStream: (async function* () {
      yield "Hello"
    })(),
  }),
  tool: (d: unknown) => d,
  jsonSchema: (s: unknown) => s,
}))

mock.module("../pipeline/model.js", () => ({
  createModel: (id: string) => ({ provider: "openai", modelId: id }),
}))

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-curator-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
  await mkdir(join(tempDir, "skills"), { recursive: true })
  generatedText = ""
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import { Curator } from "./curator.js"
import { writeSkill } from "../tools/skills/skill-store.js"
import { getUsage, setSkillPinned } from "../tools/skills/skill-usage.js"

async function loadCuratorStateRaw(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(tempDir, "skills", ".curator_state"), "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function writeUsageEntry(
  name: string,
  fields: {
    use_count?: number
    last_activity_at?: string | null
    state?: string
    pinned?: boolean
  },
): Promise<void> {
  const path = join(tempDir, "skills", ".usage.json")
  let existing: Record<string, unknown> = {}
  try {
    existing = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>
  } catch {
    // empty
  }
  existing[name] = {
    use_count: 0,
    view_count: 0,
    last_activity_at: null,
    state: "active",
    pinned: false,
    ...((existing[name] as object) ?? {}),
    ...fields,
  }
  await writeFile(path, JSON.stringify(existing, null, 2), "utf-8")
}

describe("Curator.maybeRunCurator", () => {
  it("returns wrong_plan for explore", async () => {
    const c = new Curator()
    const r = await c.maybeRunCurator({ plan: "explore" })
    expect(r.ran).toBe(false)
    expect(r.reason).toBe("wrong_plan")
  })

  it("runs once for max plan when no prior run", async () => {
    await writeSkill("a", "body", {
      manifest: { name: "a", description: "a" },
    })
    const c = new Curator()
    const r = await c.maybeRunCurator({ plan: "max" })
    expect(r.ran).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it("returns no_skills when the skills dir is empty", async () => {
    const c = new Curator()
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
    expect(r.reason).toBe("no_skills")
  })

  it("skips when the interval hasn't elapsed", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const c1 = new Curator({ intervalHours: 24 })
    const r1 = await c1.maybeRunCurator({ plan: "pro" })
    expect(r1.ran).toBe(true)
    const r2 = await c1.maybeRunCurator({ plan: "pro" })
    expect(r2.ran).toBe(false)
    expect(r2.reason).toBe("interval_not_elapsed")
  })

  it("skips when paused", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const c = new Curator()
    await c.setPaused(true)
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(false)
    expect(r.reason).toBe("paused")
    await c.setPaused(false)
  })

  it("resetInterval() forces a re-run", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const c = new Curator({ intervalHours: 24 })
    await c.maybeRunCurator({ plan: "pro" })
    await c.resetInterval()
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
  })
})

describe("Curator lifecycle transitions", () => {
  it("transitions a stale skill (30d+ inactive) to 'stale'", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()
    await writeUsageEntry("a", { last_activity_at: fortyDaysAgo, state: "active" })
    const c = new Curator({ intervalHours: 0 })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
    const u = await getUsage("a")
    expect(u.state).toBe("stale")
  })

  it("archives a skill past the archive threshold", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    await writeUsageEntry("a", { last_activity_at: hundredDaysAgo, state: "active" })
    const c = new Curator({ intervalHours: 0, archiveAfterDays: 90 })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
    expect(r.archived).toBe(1)
    const u = await getUsage("a")
    expect(u.state).toBe("archived")
    // Skill should be on disk under .archive/.
    const { readdir } = await import("node:fs/promises")
    const archiveEntries = await readdir(join(tempDir, "skills", ".archive"))
    expect(archiveEntries.some((e) => e.startsWith("a-"))).toBe(true)
  })

  it("never archives a bundled skill (immutable on every plan)", async () => {
    // Drop a bundled SKILL.md directly (the write tool refuses to create
    // one as bundled).
    const { mkdir } = await import("node:fs/promises")
    const bundled = `---
name: bundled
description: bundled
version: 1.0.0
createdBy: bundled
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
---

body
`
    await mkdir(join(tempDir, "skills", "bundled"), { recursive: true })
    await writeFile(join(tempDir, "skills", "bundled", "SKILL.md"), bundled, "utf-8")
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    await writeUsageEntry("bundled", { last_activity_at: hundredDaysAgo, state: "active" })
    const c = new Curator({ intervalHours: 0, archiveAfterDays: 90 })
    const r = await c.maybeRunCurator({ plan: "max" })
    expect(r.archived).toBe(0)
    const { readdir } = await import("node:fs/promises")
    const archiveEntries = await readdir(join(tempDir, "skills", ".archive"))
    expect(archiveEntries.filter((e) => e.startsWith("bundled-"))).toEqual([])
  })

  it("never archives a pinned skill even past the threshold", async () => {
    await writeSkill("pinned", "body", {
      manifest: { name: "pinned", description: "pinned", pinned: true },
    })
    await setSkillPinned("pinned", true)
    const hundredDaysAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    await writeUsageEntry("pinned", {
      last_activity_at: hundredDaysAgo,
      state: "active",
      pinned: true,
    })
    const c = new Curator({ intervalHours: 0, archiveAfterDays: 90 })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.archived).toBe(0)
    const u = await getUsage("pinned")
    expect(u.state).toBe("active")
  })

  it("leaves recently-active skills in 'active'", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() // 1 day
    await writeUsageEntry("a", { last_activity_at: recent, state: "active" })
    const c = new Curator({ intervalHours: 0 })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.transitioned).toBe(0)
    const u = await getUsage("a")
    expect(u.state).toBe("active")
  })
})

describe("Curator LLM review (overlaps)", () => {
  function fakeModel(): LanguageModelV1 {
    return {
      provider: "fake",
      modelId: "fake",
      specificationVersion: "v1",
    } as unknown as LanguageModelV1
  }

  it("marks the older of two duplicate skills 'stale' when the LLM confirms", async () => {
    await writeSkill("alpha", "body", {
      manifest: {
        name: "alpha",
        description: "How to write a SQL query.",
        metadata: { yomi: { tags: ["SQL", "Postgres", "Database"] } },
      },
    })
    await writeSkill("beta", "body", {
      manifest: {
        name: "beta",
        description: "SQL SELECT basics.",
        metadata: { yomi: { tags: ["SQL", "Database"] } },
      },
    })
    // alpha was just used; beta was used 60 days ago. The LLM will see the
    // overlap and confirm the duplicate. The curator should mark beta stale.
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
    await writeUsageEntry("alpha", { last_activity_at: recent, state: "active" })
    await writeUsageEntry("beta", { last_activity_at: oldDate, state: "active" })

    generatedText = JSON.stringify({ duplicate: true, reason: "same task" })

    const c = new Curator({
      intervalHours: 0,
      maxReviewPairs: 5,
      modelFactory: () => fakeModel(),
    })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
    expect(r.reviewed).toBeGreaterThan(0)
    const u = await getUsage("beta")
    expect(u.state).toBe("stale")
  })

  it("does not mark anything stale when the LLM says 'not duplicate'", async () => {
    await writeSkill("alpha", "body", {
      manifest: {
        name: "alpha",
        description: "How to write a SQL query.",
        metadata: { yomi: { tags: ["SQL", "Postgres", "Database"] } },
      },
    })
    await writeSkill("beta", "body", {
      manifest: {
        name: "beta",
        description: "SQL SELECT basics.",
        metadata: { yomi: { tags: ["SQL", "Database"] } },
      },
    })
    await writeUsageEntry("alpha", { last_activity_at: new Date().toISOString(), state: "active" })
    await writeUsageEntry("beta", { last_activity_at: new Date().toISOString(), state: "active" })

    generatedText = JSON.stringify({ duplicate: false, reason: "different concerns" })

    const c = new Curator({
      intervalHours: 0,
      maxReviewPairs: 5,
      modelFactory: () => fakeModel(),
    })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.reviewed).toBeGreaterThan(0)
    expect((await getUsage("alpha")).state).toBe("active")
    expect((await getUsage("beta")).state).toBe("active")
  })

  it("bounds the number of pairs reviewed per pass", async () => {
    // Create 5 skills, all with the same description, so the heuristic
    // pairs them all (C(5,2) = 10 pairs).
    for (let i = 0; i < 5; i++) {
      await writeSkill(`s${i}`, "body", {
        manifest: { name: `s${i}`, description: "Same desc." },
      })
      await writeUsageEntry(`s${i}`, { last_activity_at: new Date().toISOString() })
    }
    generatedText = JSON.stringify({ duplicate: false, reason: "" })
    const c = new Curator({
      intervalHours: 0,
      maxReviewPairs: 2,
      modelFactory: () => fakeModel(),
    })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.reviewed).toBe(2)
  })

  it("survives malformed LLM JSON without aborting the pass", async () => {
    await writeSkill("alpha", "body", {
      manifest: {
        name: "alpha",
        description: "Same.",
        metadata: { yomi: { tags: ["x", "y"] } },
      },
    })
    await writeSkill("beta", "body", {
      manifest: {
        name: "beta",
        description: "Same.",
        metadata: { yomi: { tags: ["x", "y"] } },
      },
    })
    await writeUsageEntry("alpha", { last_activity_at: new Date().toISOString() })
    await writeUsageEntry("beta", { last_activity_at: new Date().toISOString() })
    generatedText = "this is not json"
    const c = new Curator({
      intervalHours: 0,
      maxReviewPairs: 1,
      modelFactory: () => fakeModel(),
    })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.ran).toBe(true)
    expect(r.error).toBeUndefined()
    expect((await getUsage("alpha")).state).toBe("active")
  })
})

describe("Curator state file", () => {
  it("persists .curator_state after a run", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const c = new Curator({ intervalHours: 0 })
    await c.maybeRunCurator({ plan: "pro" })
    const state = await loadCuratorStateRaw()
    expect(state["last_run_at"]).toBeDefined()
    expect(state["run_count"]).toBe(1)
  })

  it("writeReport emits a markdown file when candidates exist", async () => {
    await writeSkill("a", "body", { manifest: { name: "a", description: "a" } })
    const c = new Curator({ intervalHours: 0 })
    const r = await c.maybeRunCurator({ plan: "pro" })
    expect(r.reportPath).toBeDefined()
    if (r.reportPath) {
      const report = await readFile(r.reportPath, "utf-8")
      expect(report).toContain("# Curator report")
      expect(report).toContain("a (agent)")
    }
  })
})
