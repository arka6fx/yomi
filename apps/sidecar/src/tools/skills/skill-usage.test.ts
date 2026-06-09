import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-usage-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
  await mkdir(join(tempDir, "skills"), { recursive: true })
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import {
  emptyRecord,
  getUsage,
  loadUsage,
  recordSkillFileView,
  recordSkillView,
  setSkillPinned,
  setSkillState,
} from "./skill-usage.js"

describe("loadUsage", () => {
  it("returns an empty map when no usage file exists", async () => {
    expect(await loadUsage()).toEqual({})
  })

  it("returns an empty map when the usage file is corrupt JSON", async () => {
    await writeFile(join(tempDir, "skills", ".usage.json"), "{not valid json", "utf-8")
    expect(await loadUsage()).toEqual({})
  })

  it("ignores non-object entries", async () => {
    await writeFile(
      join(tempDir, "skills", ".usage.json"),
      JSON.stringify({
        good: { use_count: 3, view_count: 1, state: "active" },
        bad: "not an object",
      }),
      "utf-8",
    )
    const map = await loadUsage()
    expect(map["good"]?.use_count).toBe(3)
    expect(map["bad"]).toBeUndefined()
  })

  it("coerces invalid state values to 'active'", async () => {
    await writeFile(
      join(tempDir, "skills", ".usage.json"),
      JSON.stringify({ x: { use_count: 0, state: "nonsense" } }),
      "utf-8",
    )
    const map = await loadUsage()
    expect(map["x"]?.state).toBe("active")
  })
})

describe("getUsage", () => {
  it("returns an empty record for unknown skills", async () => {
    const r = await getUsage("unknown")
    expect(r).toEqual(emptyRecord())
  })
})

describe("recordSkillView", () => {
  it("increments use_count and bumps last_activity_at", async () => {
    const r = await recordSkillView("demo")
    expect(r.use_count).toBe(1)
    expect(r.view_count).toBe(0)
    expect(r.last_activity_at).not.toBeNull()
    const r2 = await recordSkillView("demo")
    expect(r2.use_count).toBe(2)
  })

  it("resets state to active on every view", async () => {
    await setSkillState("demo", "stale")
    const r = await recordSkillView("demo")
    expect(r.state).toBe("active")
  })

  it("pins via the record call", async () => {
    const r = await recordSkillView("pinned", { pinned: true })
    expect(r.pinned).toBe(true)
  })
})

describe("recordSkillFileView", () => {
  it("increments view_count separately from use_count", async () => {
    await recordSkillView("demo")
    const r = await recordSkillFileView("demo")
    expect(r.use_count).toBe(1)
    expect(r.view_count).toBe(1)
  })
})

describe("setSkillState", () => {
  it("updates state without resetting counters", async () => {
    await recordSkillView("demo")
    const before = await getUsage("demo")
    const r = await setSkillState("demo", "stale")
    expect(r.state).toBe("stale")
    expect(r.use_count).toBe(before.use_count)
  })
})

describe("setSkillPinned", () => {
  it("toggles pinned without touching counters", async () => {
    await recordSkillView("demo")
    const r = await setSkillPinned("demo", true)
    expect(r.pinned).toBe(true)
  })
})
