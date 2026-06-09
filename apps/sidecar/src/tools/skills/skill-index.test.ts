import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-index-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import { buildSkillIndexBlock, loadSkillIndex } from "./skill-index.js"
import { writeSkill } from "./skill-store.js"
import { recordSkillView } from "./skill-usage.js"

describe("loadSkillIndex", () => {
  it("returns an empty list when no skills exist", async () => {
    const out = await loadSkillIndex()
    expect(out).toEqual([])
  })

  it("returns one entry per skill, skipping parse failures", async () => {
    await writeSkill("alpha", "body", {
      manifest: { name: "alpha", description: "First skill." },
    })
    await writeSkill("beta", "body", {
      manifest: { name: "beta", description: "Second skill." },
    })
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(join(tempDir, "skills", "broken"), { recursive: true })
    await writeFile(join(tempDir, "skills", "broken", "SKILL.md"), "no frontmatter", "utf-8")
    const out = await loadSkillIndex()
    const names = out.map((e) => e.summary.name).sort()
    expect(names).toEqual(["alpha", "beta"])
  })

  it("sorts pinned skills first", async () => {
    await writeSkill("z", "body", { manifest: { name: "z", description: "z", pinned: false } })
    await writeSkill("a", "body", { manifest: { name: "a", description: "a", pinned: true } })
    const out = await loadSkillIndex()
    expect(out[0]?.summary.name).toBe("a")
    expect(out[1]?.summary.name).toBe("z")
  })

  it("sorts by most-recently-used when not pinned", async () => {
    await writeSkill("old", "body", { manifest: { name: "old", description: "old" } })
    await new Promise((r) => setTimeout(r, 5))
    await writeSkill("new", "body", { manifest: { name: "new", description: "new" } })
    await recordSkillView("new")
    const out = await loadSkillIndex()
    expect(out[0]?.summary.name).toBe("new")
  })

  it("respects the cap option", async () => {
    for (let i = 0; i < 5; i++) {
      await writeSkill(`s${i}`, "body", {
        manifest: { name: `s${i}`, description: `d${i}` },
      })
    }
    const out = await loadSkillIndex({ cap: 2 })
    expect(out).toHaveLength(2)
  })
})

describe("buildSkillIndexBlock", () => {
  it("returns an empty string when no skills exist", async () => {
    expect(await buildSkillIndexBlock()).toBe("")
  })

  it("wraps the index in a <skills> block with a usage hint", async () => {
    await writeSkill("alpha", "body", {
      manifest: { name: "alpha", description: "First skill." },
    })
    const block = await buildSkillIndexBlock()
    expect(block).toContain("<skills>")
    expect(block).toContain("</skills>")
    expect(block).toContain("alpha")
    expect(block).toContain("First skill.")
    expect(block).toContain("skill_view")
  })

  it("truncates long descriptions to keep the block compact", async () => {
    await writeSkill("alpha", "body", {
      manifest: {
        name: "alpha",
        description: "x".repeat(200),
      },
    })
    const block = await buildSkillIndexBlock()
    // The full 200-char description must not appear, but a truncated form
    // should — the truncation appends an ellipsis.
    expect(block).not.toContain("x".repeat(200))
    expect(block).toMatch(/x+\s*…/)
  })

  it("marks pinned skills with a pin indicator", async () => {
    await writeSkill("pinned", "body", {
      manifest: { name: "pinned", description: "Pin me", pinned: true },
    })
    const block = await buildSkillIndexBlock()
    expect(block).toContain("📌")
  })

  it("shows the last-activity date for used skills", async () => {
    await writeSkill("alpha", "body", {
      manifest: { name: "alpha", description: "First skill." },
    })
    await recordSkillView("alpha")
    const block = await buildSkillIndexBlock()
    expect(block).toMatch(/last \d{4}-\d{2}-\d{2}/)
    expect(block).toMatch(/used \d+×/)
  })
})
