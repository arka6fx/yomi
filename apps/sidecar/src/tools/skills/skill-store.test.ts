import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-store-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
  await mkdir(join(tempDir, "skills"), { recursive: true })
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import {
  archiveSkill,
  countActiveSkills,
  editSkill,
  ensureSkillsDir,
  listSkillFiles,
  listSkills,
  readSkill,
  readSkillFile,
  removeSkillFile,
  safeJoin,
  SkillAlreadyExistsError,
  SkillNotFoundError,
  SkillPathError,
  SkillValidationError,
  unarchiveSkill,
  writeSkill,
  writeSkillFile,
} from "./skill-store.js"
import { renderSkillMarkdown } from "./frontmatter.js"
import type { SkillManifest } from "./skill-types.js"

const manifestBase = (overrides: Partial<SkillManifest> = {}): SkillManifest => ({
  name: "demo",
  description: "A demo skill.",
  version: "1.0.0",
  createdBy: "agent",
  createdAt: "2026-06-08T00:00:00.000Z",
  updatedAt: "2026-06-08T00:00:00.000Z",
  ...overrides,
})

describe("ensureSkillsDir", () => {
  it("creates the skills root and .archive subdir", async () => {
    await ensureSkillsDir()
    const entries = await (await import("node:fs/promises")).readdir(tempDir)
    expect(entries).toContain("skills")
    const skillEntries = await (await import("node:fs/promises")).readdir(join(tempDir, "skills"))
    expect(skillEntries).toContain(".archive")
  })
})

describe("writeSkill", () => {
  it("creates a skill directory with SKILL.md", async () => {
    const result = await writeSkill("demo", "## hello", {
      manifest: { name: "demo", description: "A demo skill." },
    })
    expect(result.manifest.name).toBe("demo")
    expect(result.manifest.createdBy).toBe("agent")
    const onDisk = await readFile(join(tempDir, "skills", "demo", "SKILL.md"), "utf-8")
    expect(onDisk).toContain("name: demo")
    expect(onDisk).toContain("## hello")
  })

  it("rejects duplicate names", async () => {
    await writeSkill("demo", "body", { manifest: { name: "demo", description: "x" } })
    await expect(
      writeSkill("demo", "body2", { manifest: { name: "demo", description: "y" } }),
    ).rejects.toThrow(SkillAlreadyExistsError)
  })

  it("rejects invalid names", async () => {
    await expect(
      writeSkill("Bad Name", "body", { manifest: { name: "Bad Name", description: "x" } }),
    ).rejects.toThrow(SkillValidationError)
  })
})

describe("readSkill", () => {
  it("reads back a written skill", async () => {
    await writeSkill("demo", "## hello", { manifest: { name: "demo", description: "x" } })
    const skill = await readSkill("demo")
    expect(skill.manifest.name).toBe("demo")
    expect(skill.body.trim()).toBe("## hello")
  })

  it("throws SkillNotFoundError for missing skills", async () => {
    await expect(readSkill("missing")).rejects.toThrow(SkillNotFoundError)
  })
})

describe("editSkill", () => {
  it("updates the body and bumps updatedAt", async () => {
    await writeSkill("demo", "old", { manifest: { name: "demo", description: "x" } })
    const before = await readSkill("demo")
    await new Promise((r) => setTimeout(r, 5))
    const after = await editSkill("demo", "new body")
    expect(after.body.trim()).toBe("new body")
    expect(after.manifest.updatedAt).not.toBe(before.manifest.updatedAt)
    expect(after.manifest.createdAt).toBe(before.manifest.createdAt)
  })

  it("preserves createdBy and createdAt", async () => {
    await writeSkill("demo", "body", {
      manifest: { name: "demo", description: "x", createdBy: "bundled" },
    })
    const after = await editSkill("demo", "new")
    expect(after.manifest.createdBy).toBe("bundled")
  })

  it("throws on missing skill", async () => {
    await expect(editSkill("missing", "x")).rejects.toThrow(SkillNotFoundError)
  })
})

describe("writeSkillFile / readSkillFile / removeSkillFile", () => {
  beforeEach(async () => {
    await writeSkill("demo", "body", { manifest: { name: "demo", description: "x" } })
  })

  it("writes and reads a supporting file", async () => {
    await writeSkillFile("demo", "references/foo.md", "# Foo")
    const out = await readSkillFile("demo", "references/foo.md")
    expect(out).toBe("# Foo")
    const files = await listSkillFiles("demo")
    expect(files).toContain("references/foo.md")
  })

  it("rejects absolute paths", async () => {
    await expect(writeSkillFile("demo", "/etc/passwd", "x")).rejects.toThrow(SkillPathError)
  })

  it("rejects path traversal", async () => {
    await expect(writeSkillFile("demo", "../escape.md", "x")).rejects.toThrow(SkillPathError)
  })

  it("enforces the 1 MiB cap", async () => {
    const big = "x".repeat(1024 * 1024 + 1)
    await expect(writeSkillFile("demo", "big.md", big)).rejects.toThrow(SkillValidationError)
  })

  it("removes a supporting file", async () => {
    await writeSkillFile("demo", "foo.md", "x")
    await removeSkillFile("demo", "foo.md")
    const files = await listSkillFiles("demo")
    expect(files).not.toContain("foo.md")
  })
})

describe("archiveSkill / unarchiveSkill", () => {
  it("moves a skill to .archive and restores it", async () => {
    await writeSkill("demo", "body", { manifest: { name: "demo", description: "x" } })
    const archived = await archiveSkill("demo")
    expect(archived).toContain(".archive")
    expect(archived).toContain("demo-")
    await expect(readSkill("demo")).rejects.toThrow(SkillNotFoundError)

    const restored = await unarchiveSkill("demo")
    expect(restored).toBe(join(tempDir, "skills", "demo"))
    const skill = await readSkill("demo")
    expect(skill.body.trim()).toBe("body")
  })

  it("unarchiveSkill throws when no archive exists", async () => {
    await expect(unarchiveSkill("missing")).rejects.toThrow(SkillNotFoundError)
  })
})

describe("listSkills", () => {
  it("lists valid skills and surfaces parse errors", async () => {
    await writeSkill("good", "body", { manifest: { name: "good", description: "x" } })
    // Drop a malformed SKILL.md next to it (no frontmatter delimiter).
    await mkdir(join(tempDir, "skills", "broken"), { recursive: true })
    await writeFile(join(tempDir, "skills", "broken", "SKILL.md"), "no frontmatter", "utf-8")
    const all = await listSkills()
    const names = all.map((s) => s.summary.name)
    expect(names).toContain("good")
    expect(names).toContain("broken")
    const broken = all.find((s) => s.summary.name === "broken")
    expect(broken?.parseError).toBeDefined()
  })

  it("returns an empty list when no skills exist", async () => {
    const all = await listSkills()
    expect(all).toEqual([])
  })
})

describe("countActiveSkills", () => {
  it("counts only non-archived skills", async () => {
    await writeSkill("a", "b", { manifest: { name: "a", description: "x" } })
    await writeSkill("c", "d", { manifest: { name: "c", description: "x" } })
    expect(await countActiveSkills()).toBe(2)
    await archiveSkill("a")
    expect(await countActiveSkills()).toBe(1)
  })
})

describe("safeJoin", () => {
  it("rejects paths that escape the root", () => {
    const root = join(tempDir, "skills", "demo")
    expect(() => safeJoin(root, "../escape.md")).toThrow(SkillPathError)
  })

  it("accepts a path inside the root", () => {
    const root = join(tempDir, "skills", "demo")
    const out = safeJoin(root, "references/foo.md")
    expect(out).toContain("foo.md")
    expect(out).toContain("references")
  })
})

describe("atomic write (via writeSkill)", () => {
  it("renders a clean SKILL.md that re-parses", async () => {
    const manifest = manifestBase({ name: "rt", description: "rt" })
    const rendered = renderSkillMarkdown(manifest, "# Roundtrip")
    expect(rendered).toContain("name: rt")
    expect(rendered).toContain("# Roundtrip")
  })
})
