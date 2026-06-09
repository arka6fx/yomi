import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

let tempDir = ""

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "yomi-skill-write-"))
  process.env["YOMI_NOTEPAD_DIR"] = tempDir
})

afterEach(async () => {
  delete process.env["YOMI_NOTEPAD_DIR"]
  await rm(tempDir, { recursive: true, force: true })
})

import { createSkillTools } from "./skill-tools-write.js"
import { readSkill, writeSkillFile } from "./skill-store.js"
import type { SkillWriteResult } from "./skill-tools-write.js"

async function call<T>(
  name: string,
  args: Record<string, unknown>,
  plan: "explore" | "pro" | "max" = "pro",
): Promise<T> {
  const tools = createSkillTools({ plan })
  const tool = tools[name as keyof typeof tools] as unknown as {
    execute: (a: unknown, ctx: unknown) => Promise<unknown>
  }
  return (await tool.execute(args, { toolCallId: "t1", messages: [] } as never)) as T
}

describe("skill_create", () => {
  it("creates a skill on a paid plan", async () => {
    const r = await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "Demo skill.",
      body: "## body",
    })
    expect(r.ok).toBe(true)
    expect(r.name).toBe("demo")
    expect(r.manifest?.createdBy).toBe("agent")
  })

  it("blocks creation on explore", async () => {
    const r = await call<SkillWriteResult>(
      "skill_create",
      { name: "demo", description: "Demo skill.", body: "body" },
      "explore",
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("Pro plan")
    expect(r.upgrade_url).toBeDefined()
  })

  it("rejects duplicate names", async () => {
    await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "first",
      body: "body",
    })
    const r = await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "second",
      body: "body",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("already exists")
  })

  it("rejects invalid names", async () => {
    const r = await call<SkillWriteResult>("skill_create", {
      name: "Bad Name",
      description: "x",
      body: "body",
    })
    expect(r.ok).toBe(false)
  })

  it("rejects bodies over 64 KiB", async () => {
    const r = await call<SkillWriteResult>("skill_create", {
      name: "big",
      description: "x",
      body: "x".repeat(65 * 1024),
    })
    expect(r.ok).toBe(false)
  })
})

describe("skill_edit", () => {
  beforeEach(async () => {
    await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "Original.",
      body: "old body",
    })
  })

  it("replaces the body and bumps updatedAt", async () => {
    const before = await readSkill("demo")
    await new Promise((r) => setTimeout(r, 5))
    const r = await call<SkillWriteResult>("skill_edit", {
      name: "demo",
      body: "new body",
      description: "Updated.",
    })
    expect(r.ok).toBe(true)
    const after = await readSkill("demo")
    expect(after.body.trim()).toBe("new body")
    expect(after.manifest.description).toBe("Updated.")
    expect(after.manifest.updatedAt).not.toBe(before.manifest.updatedAt)
  })

  it("rejects when the skill is missing", async () => {
    const r = await call<SkillWriteResult>("skill_edit", {
      name: "missing",
      body: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("skill not found")
  })
})

describe("skill_patch", () => {
  beforeEach(async () => {
    await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "Demo.",
      body: "alpha beta alpha gamma",
    })
  })

  it("replaces only the first match by default", async () => {
    const r = await call<SkillWriteResult>("skill_patch", {
      name: "demo",
      oldText: "alpha",
      newText: "ALPHA",
    })
    expect(r.ok).toBe(true)
    const after = await readSkill("demo")
    expect(after.body.trim()).toBe("ALPHA beta alpha gamma")
  })

  it("replaces every match when allOccurrences=true", async () => {
    const r = await call<SkillWriteResult>("skill_patch", {
      name: "demo",
      oldText: "alpha",
      newText: "ALPHA",
      allOccurrences: true,
    })
    expect(r.ok).toBe(true)
    const after = await readSkill("demo")
    expect(after.body.trim()).toBe("ALPHA beta ALPHA gamma")
  })

  it("returns an error when oldText is not found", async () => {
    const r = await call<SkillWriteResult>("skill_patch", {
      name: "demo",
      oldText: "missing",
      newText: "x",
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("not found")
  })

  it("rejects empty oldText", async () => {
    const r = await call<SkillWriteResult>("skill_patch", {
      name: "demo",
      oldText: "",
      newText: "x",
    })
    expect(r.ok).toBe(false)
  })
})

describe("skill_delete / skill_unarchive", () => {
  it("archives a skill and restores it", async () => {
    await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "x",
      body: "body",
    })
    const del = await call<SkillWriteResult>("skill_delete", { name: "demo" })
    expect(del.ok).toBe(true)
    expect(del.archive_path).toContain(".archive")
    await expect(readSkill("demo")).rejects.toThrow()

    const restore = await call<SkillWriteResult>("skill_unarchive", { name: "demo" })
    expect(restore.ok).toBe(true)
    const restored = await readSkill("demo")
    expect(restored.body.trim()).toBe("body")
  })

  it("returns an error when unarchiving a skill that was never archived", async () => {
    const r = await call<SkillWriteResult>("skill_unarchive", { name: "never-archived" })
    expect(r.ok).toBe(false)
  })
})

describe("skill_write_file / skill_remove_file", () => {
  beforeEach(async () => {
    await call<SkillWriteResult>("skill_create", {
      name: "demo",
      description: "x",
      body: "body",
    })
  })

  it("writes a supporting file", async () => {
    const r = await call<SkillWriteResult>("skill_write_file", {
      name: "demo",
      path: "references/foo.md",
      content: "# Foo",
    })
    expect(r.ok).toBe(true)
    const skill = await readSkill("demo")
    expect(skill.files).toContain("references/foo.md")
  })

  it("blocks path traversal", async () => {
    const r = await call<SkillWriteResult>("skill_write_file", {
      name: "demo",
      path: "../escape.md",
      content: "x",
    })
    expect(r.ok).toBe(false)
  })

  it("enforces the 1 MiB cap", async () => {
    const r = await call<SkillWriteResult>("skill_write_file", {
      name: "demo",
      path: "big.md",
      content: "x".repeat(1024 * 1024 + 1),
    })
    expect(r.ok).toBe(false)
  })

  it("removes a supporting file", async () => {
    await writeSkillFile("demo", "foo.md", "x")
    const r = await call<SkillWriteResult>("skill_remove_file", {
      name: "demo",
      path: "foo.md",
    })
    expect(r.ok).toBe(true)
    const skill = await readSkill("demo")
    expect(skill.files).not.toContain("foo.md")
  })
})

describe("bundled skills are immutable on every plan", () => {
  it("blocks edit on a bundled skill even on max", async () => {
    // Create a skill as bundled by writing the manifest directly.
    const { mkdir, writeFile } = await import("node:fs/promises")
    await mkdir(join(tempDir, "skills", "bundled"), { recursive: true })
    const md = `---
name: bundled
description: Bundled skill.
version: 1.0.0
createdBy: bundled
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
---

body
`
    await writeFile(join(tempDir, "skills", "bundled", "SKILL.md"), md, "utf-8")

    const r = await call<SkillWriteResult>(
      "skill_edit",
      { name: "bundled", body: "tampered" },
      "max",
    )
    expect(r.ok).toBe(false)
    expect(r.reason).toContain("bundled")
  })
})

describe("createSkillTools vs createReadOnlySkillTools", () => {
  it("the read-only factory omits write tools", async () => {
    const { createReadOnlySkillTools } = await import("./skill-tools-write.js")
    const ro = createReadOnlySkillTools({ plan: "pro" })
    expect(Object.keys(ro).sort()).toEqual(["skill_list", "skill_read_file", "skill_view"])
    const full = createSkillTools({ plan: "pro" })
    expect(Object.keys(full)).toContain("skill_create")
    expect(Object.keys(full)).toContain("skill_edit")
  })
})
