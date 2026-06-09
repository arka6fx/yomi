import { describe, expect, it } from "bun:test"
import { parseFrontmatter, renderSkillMarkdown, FrontmatterParseError } from "./frontmatter.js"
import type { SkillManifest } from "./skill-types.js"

describe("parseFrontmatter", () => {
  it("parses scalar fields", () => {
    const md = `---
name: demo
description: A demo skill.
version: 1.2.0
author: Yomi Agent
license: MIT
createdBy: agent
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
pinned: true
---

# Demo

body text here
`
    const { manifest, body } = parseFrontmatter(md)
    expect(manifest.name).toBe("demo")
    expect(manifest.description).toBe("A demo skill.")
    expect(manifest.version).toBe("1.2.0")
    expect(manifest.author).toBe("Yomi Agent")
    expect(manifest.license).toBe("MIT")
    expect(manifest.createdBy).toBe("agent")
    expect(manifest.createdAt).toBe("2026-06-08T00:00:00.000Z")
    expect(manifest.updatedAt).toBe("2026-06-08T00:00:00.000Z")
    expect(manifest.pinned).toBe(true)
    expect(body).toContain("# Demo")
    expect(body).toContain("body text here")
  })

  it("parses platforms list", () => {
    const md = `---
name: demo
description: desc
createdBy: user
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
platforms: [linux, macos, windows]
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.platforms).toEqual(["linux", "macos", "windows"])
  })

  it("parses metadata.yomi tags and relatedSkills", () => {
    const md = `---
name: demo
description: desc
createdBy: agent
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
metadata:
  tags: [GitHub, "Pull Requests"]
  relatedSkills: [github-auth]
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.metadata?.yomi?.tags).toEqual(["GitHub", "Pull Requests"])
    expect(manifest.metadata?.yomi?.relatedSkills).toEqual(["github-auth"])
  })

  it("preserves unknown top-level keys in extra", () => {
    const md = `---
name: demo
description: desc
createdBy: user
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
customField: hello
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.extra).toEqual({ customField: "hello" })
  })

  it("falls back to defaults for missing required-by-our-schema fields", () => {
    const md = `---
name: demo
description: desc
createdBy: bundled
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.createdBy).toBe("bundled")
    expect(manifest.version).toBe("1.0.0")
    // The createdAt/updatedAt fall back to the epoch when missing/invalid.
    expect(manifest.createdAt).toBe(new Date(0).toISOString())
  })

  it("coerces invalid createdBy to 'user'", () => {
    const md = `---
name: demo
description: desc
createdBy: nonsense
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.createdBy).toBe("user")
  })

  it("throws when the frontmatter delimiter is missing", () => {
    expect(() => parseFrontmatter("no frontmatter here")).toThrow(FrontmatterParseError)
  })

  it("throws when the frontmatter is not closed", () => {
    expect(() => parseFrontmatter("---\nname: x\nno close here")).toThrow(FrontmatterParseError)
  })

  it("throws when name is missing", () => {
    expect(() => parseFrontmatter("---\ndescription: only desc\n---\nbody")).toThrow(
      FrontmatterParseError,
    )
  })

  it("throws when description is missing", () => {
    expect(() => parseFrontmatter("---\nname: only-name\n---\nbody")).toThrow(FrontmatterParseError)
  })

  it("ignores comment lines", () => {
    const md = `---
# this is a comment
name: demo
# another comment
description: desc
---

body
`
    const { manifest } = parseFrontmatter(md)
    expect(manifest.name).toBe("demo")
  })

  it("round-trips through renderSkillMarkdown", () => {
    const md = `---
name: roundtrip
description: A round-trip test.
version: 1.0.0
createdBy: agent
createdAt: 2026-06-08T00:00:00.000Z
updatedAt: 2026-06-08T00:00:00.000Z
---

# Round trip

The body.
`
    const { manifest, body } = parseFrontmatter(md)
    const rendered = renderSkillMarkdown(manifest, body)
    const reparsed = parseFrontmatter(rendered)
    expect(reparsed.manifest.name).toBe("roundtrip")
    expect(reparsed.manifest.description).toBe("A round-trip test.")
    expect(reparsed.body.trim()).toBe(body.trim())
  })

  it("escapes quotes and special chars in renderSkillMarkdown", () => {
    const manifest: SkillManifest = {
      name: "quoted",
      description: 'desc with "quotes" and : colons',
      version: "1.0.0",
      createdBy: "agent",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    }
    const rendered = renderSkillMarkdown(manifest, "body")
    // The renderer escapes embedded double-quotes so the YAML stays valid.
    expect(rendered).toContain('\\"quotes\\"')
    const reparsed = parseFrontmatter(rendered)
    expect(reparsed.manifest.description).toBe('desc with "quotes" and : colons')
  })

  it("renders pinned only when true", () => {
    const base: SkillManifest = {
      name: "p",
      description: "d",
      version: "1.0.0",
      createdBy: "agent",
      createdAt: "2026-06-08T00:00:00.000Z",
      updatedAt: "2026-06-08T00:00:00.000Z",
    }
    const rendered = renderSkillMarkdown({ ...base, pinned: true }, "b")
    expect(rendered).toContain("pinned: true")
    const rendered2 = renderSkillMarkdown({ ...base, pinned: false }, "b")
    expect(rendered2).not.toContain("pinned:")
  })
})
