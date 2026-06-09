import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-read-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import { createSkillReadTools } from "./skill-tools-read.js"
import { writeSkill, writeSkillFile, SkillNotFoundError } from "./skill-store.js"
import { renderSkillMarkdown } from "./frontmatter.js"
import type { SkillManifest } from "./skill-types.js"

const manifest = (overrides: Partial<SkillManifest> = {}): SkillManifest => ({
  name: "demo",
  description: "A demo skill.",
  version: "1.0.0",
  createdBy: "agent",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
  ...overrides,
})

describe("skill_list", () => {
  it("returns an empty list when no skills exist", async () => {
    const tools = createSkillReadTools({})
    const result = await tools["skill_list"]!.execute!({}, {
      toolCallId: "t1",
      messages: [],
    } as never)
    // No plan → defaults to read-only per the spec.
    expect(result).toEqual({ skills: [], total: 0, readOnly: true })
  })

  it("lists existing skills with their metadata", async () => {
    await writeSkill("alpha", "# alpha body", {
      manifest: { name: "alpha", description: "First skill." },
    })
    await writeSkill("beta", "# beta body", {
      manifest: { name: "beta", description: "Second skill." },
    })
    const tools = createSkillReadTools({})
    const result = (await tools["skill_list"]!.execute!({}, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { skills: Array<{ name: string; description: string }>; total: number }
    expect(result.total).toBe(2)
    const names = result.skills.map((s) => s.name).sort()
    expect(names).toEqual(["alpha", "beta"])
    expect(result.skills.find((s) => s.name === "alpha")?.description).toBe("First skill.")
  })

  it("marks readOnly=true on explore", async () => {
    const tools = createSkillReadTools({ plan: "explore" })
    const result = (await tools["skill_list"]!.execute!({}, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { readOnly: boolean }
    expect(result.readOnly).toBe(true)
  })

  it("marks readOnly=false on pro/max", async () => {
    for (const plan of ["pro", "max"] as const) {
      const tools = createSkillReadTools({ plan })
      const result = (await tools["skill_list"]!.execute!({}, {
        toolCallId: "t1",
        messages: [],
      } as never)) as { readOnly: boolean }
      expect(result.readOnly).toBe(false)
    }
  })

  it("surfaces parse errors as best-effort summaries", async () => {
    await writeSkill("good", "body", { manifest: { name: "good", description: "x" } })
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(join(tempDir, "skills", "broken"), { recursive: true })
    await writeFile(join(tempDir, "skills", "broken", "SKILL.md"), "no frontmatter", "utf-8")
    const tools = createSkillReadTools({})
    const result = (await tools["skill_list"]!.execute!({}, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { total: number; skills: Array<{ name: string; description: string }> }
    expect(result.total).toBe(2)
    const broken = result.skills.find((s) => s.name === "broken")
    expect(broken?.description).toBe("(unparsed)")
  })
})

describe("skill_view", () => {
  it("returns the full body and manifest for a known skill", async () => {
    await writeSkill("alpha", "## body content", {
      manifest: { name: "alpha", description: "Test" },
    })
    const tools = createSkillReadTools({})
    const result = (await tools["skill_view"]!.execute!({ name: "alpha" }, {
      toolCallId: "t1",
      messages: [],
    } as never)) as {
      name: string
      body: string
      description: string
      manifest: { createdBy: string }
    }
    expect(result.name).toBe("alpha")
    expect(result.body).toContain("## body content")
    expect(result.description).toBe("Test")
    expect(result.manifest.createdBy).toBe("agent")
  })

  it("returns an error object for a missing skill", async () => {
    const tools = createSkillReadTools({})
    const result = (await tools["skill_view"]!.execute!({ name: "missing" }, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { error?: string }
    expect(result.error).toContain("skill not found")
  })

  it("bumps use_count on every view (telemetry)", async () => {
    const { getUsage } = await import("./skill-usage.js")
    await writeSkill("alpha", "## body", {
      manifest: { name: "alpha", description: "Test" },
    })
    expect((await getUsage("alpha")).use_count).toBe(0)
    const tools = createSkillReadTools({})
    await tools["skill_view"]!.execute!({ name: "alpha" }, {
      toolCallId: "t1",
      messages: [],
    } as never)
    expect((await getUsage("alpha")).use_count).toBe(1)
    await tools["skill_view"]!.execute!({ name: "alpha" }, {
      toolCallId: "t2",
      messages: [],
    } as never)
    expect((await getUsage("alpha")).use_count).toBe(2)
  })
})

describe("skill_read_file", () => {
  beforeEach(async () => {
    await writeSkill("alpha", "body", { manifest: { name: "alpha", description: "x" } })
    await writeSkillFile("alpha", "references/foo.md", "# Foo Content")
  })

  it("returns the file content for a known file", async () => {
    const tools = createSkillReadTools({})
    const result = (await tools["skill_read_file"]!.execute!(
      { name: "alpha", path: "references/foo.md" },
      { toolCallId: "t1", messages: [] } as never,
    )) as { content?: string; error?: string }
    expect(result.content).toBe("# Foo Content")
  })

  it("returns an error for path traversal", async () => {
    const tools = createSkillReadTools({})
    const result = (await tools["skill_read_file"]!.execute!(
      { name: "alpha", path: "../escape.md" },
      { toolCallId: "t1", messages: [] } as never,
    )) as { error?: string }
    expect(result.error).toBeDefined()
  })

  it("returns an error for a missing skill", async () => {
    const tools = createSkillReadTools({})
    const result = (await tools["skill_read_file"]!.execute!({ name: "missing", path: "x" }, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { error?: string }
    expect(result.error).toContain("skill not found")
  })

  it("bumps view_count on every file read (telemetry)", async () => {
    const { getUsage } = await import("./skill-usage.js")
    // beforeEach has already created `alpha` + `references/foo.md`.
    expect((await getUsage("alpha")).view_count).toBe(0)
    const tools = createSkillReadTools({})
    await tools["skill_read_file"]!.execute!({ name: "alpha", path: "references/foo.md" }, {
      toolCallId: "t1",
      messages: [],
    } as never)
    expect((await getUsage("alpha")).view_count).toBe(1)
  })
})

describe("read tools preserve manifest fields round-trip", () => {
  it("preserves platforms and metadata when reading back", async () => {
    const m: SkillManifest = manifest({
      name: "rt",
      description: "Round-trip test",
      platforms: ["linux", "macos"],
      metadata: { yomi: { tags: ["x"], relatedSkills: ["y"] } },
    })
    const markdown = renderSkillMarkdown(m, "body")
    const { writeFile, mkdir } = await import("node:fs/promises")
    await mkdir(join(tempDir, "skills", "rt"), { recursive: true })
    await writeFile(join(tempDir, "skills", "rt", "SKILL.md"), markdown, "utf-8")
    const tools = createSkillReadTools({})
    const result = (await tools["skill_view"]!.execute!({ name: "rt" }, {
      toolCallId: "t1",
      messages: [],
    } as never)) as { manifest: { platforms?: string[]; metadata?: unknown } }
    expect(result.manifest.platforms).toEqual(["linux", "macos"])
    expect(result.manifest.metadata).toBeDefined()
  })
})

// Sanity: the export from the store is what we expect — guards against
// accidental re-export drift.
describe("store exports sanity", () => {
  it("SkillNotFoundError is a class", () => {
    const err = new SkillNotFoundError("x")
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain("x")
  })
})
