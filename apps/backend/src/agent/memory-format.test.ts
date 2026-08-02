import { describe, expect, it } from "bun:test"
import { formatMemoryAge, formatMemorySnippet, formatProfileLine } from "./memory-format.js"

const NOW = new Date("2026-08-01T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const DAY = 24 * 60 * 60 * 1000

describe("formatMemoryAge", () => {
  it("reports the same day as today", () => {
    expect(formatMemoryAge(ago(3 * 60 * 60 * 1000), NOW)).toBe("today")
  })

  it("reports the previous day as yesterday", () => {
    expect(formatMemoryAge(ago(30 * 60 * 60 * 1000), NOW)).toBe("yesterday")
  })

  it("reports days within the last week", () => {
    expect(formatMemoryAge(ago(3 * DAY), NOW)).toBe("3d ago")
  })

  it("reports weeks", () => {
    expect(formatMemoryAge(ago(14 * DAY), NOW)).toBe("2w ago")
  })

  it("reports months", () => {
    expect(formatMemoryAge(ago(60 * DAY), NOW)).toBe("2mo ago")
  })

  it("reports years", () => {
    expect(formatMemoryAge(ago(400 * DAY), NOW)).toBe("1y ago")
  })

  it("returns empty for a missing or unparseable timestamp", () => {
    expect(formatMemoryAge(null, NOW)).toBe("")
    expect(formatMemoryAge(undefined, NOW)).toBe("")
    expect(formatMemoryAge("not a date", NOW)).toBe("")
  })
})

describe("formatMemorySnippet", () => {
  const row = {
    kind: "preference",
    topic: "editor",
    content: "Uses vim",
    sourcePath: null,
    updatedAt: ago(3 * DAY),
    matchedBy: ["vector", "full_text"],
  }

  it("carries the memory's age so the model can tell which of two memories is current", () => {
    expect(formatMemorySnippet(row, NOW)).toContain("3d ago")
  })

  it("never renders the confidence number, which misdirects the model", () => {
    const withConfidence = { ...row, confidence: 90 }
    const out = formatMemorySnippet(withConfidence, NOW)
    expect(out).not.toContain("confidence")
    expect(out).not.toContain("90")
  })

  it("keeps kind, matched sources, topic and content", () => {
    const out = formatMemorySnippet(row, NOW)
    expect(out).toContain("preference")
    expect(out).toContain("vector+full_text")
    expect(out).toContain("editor")
    expect(out).toContain("Uses vim")
  })

  it("appends the source path when there is one", () => {
    expect(formatMemorySnippet({ ...row, sourcePath: "notes/a.md" }, NOW)).toContain(
      "(source: notes/a.md)",
    )
  })

  it("degrades to a snippet without an age when the timestamp is unusable", () => {
    const out = formatMemorySnippet({ ...row, updatedAt: "not a date" }, NOW)
    expect(out).toContain("Uses vim")
    expect(out).not.toContain("undefined")
    expect(out).not.toContain("NaN")
  })

  it("orders a newer memory's age ahead of an older one for the same topic", () => {
    const stale = formatMemorySnippet({ ...row, content: "Uses vim", updatedAt: ago(200 * DAY) }, NOW)
    const fresh = formatMemorySnippet({ ...row, content: "Uses VS Code", updatedAt: ago(1 * DAY) }, NOW)
    expect(stale).toContain("7mo ago")
    expect(fresh).toContain("yesterday")
  })
})

describe("formatProfileLine", () => {
  it("carries the age alongside the remembered text", () => {
    const out = formatProfileLine(
      { summary: null, content: "Prefers TypeScript", updatedAt: ago(2 * DAY) },
      NOW,
    )
    expect(out).toContain("Prefers TypeScript")
    expect(out).toContain("2d ago")
  })

  it("prefers the summary over the full content", () => {
    const out = formatProfileLine(
      { summary: "Likes TS", content: "Prefers TypeScript over JavaScript", updatedAt: ago(DAY) },
      NOW,
    )
    expect(out).toContain("Likes TS")
    expect(out).not.toContain("over JavaScript")
  })

  it("degrades to just the text when the timestamp is unusable", () => {
    const out = formatProfileLine({ summary: null, content: "Prefers TypeScript" }, NOW)
    expect(out).toContain("Prefers TypeScript")
    expect(out).not.toContain("undefined")
    expect(out).not.toContain("NaN")
  })
})
