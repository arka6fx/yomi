import { describe, expect, it } from "vitest"
import { closeOpenMarks, parseInline, parseMarkdown } from "./chat-markdown"

describe("chat markdown", () => {
  it("drops the blank lines a reply starts with", () => {
    expect(parseMarkdown("\n\n\nhello")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "hello" }]] },
    ])
  })

  it("reads bold, code, links and bare urls", () => {
    expect(parseInline("**ci** is `red`: https://x.dev/run.")).toEqual([
      { type: "bold", text: "ci" },
      { type: "text", text: " is " },
      { type: "code", text: "red" },
      { type: "text", text: ": " },
      { type: "link", text: "https://x.dev/run", href: "https://x.dev/run" },
      { type: "text", text: "." },
    ])
  })

  it("groups numbered and bullet lists and keeps indented follow-ups", () => {
    const blocks = parseMarkdown("1. first\n   → more\n2. second\n\n- a\n- b")
    expect(blocks.map((b) => b.type)).toEqual(["list", "list"])
    const [numbered, bullets] = blocks as Extract<(typeof blocks)[number], { type: "list" }>[]
    expect(numbered.ordered).toBe(true)
    expect(numbered.items).toHaveLength(2)
    expect(numbered.items[0].inline.at(-1)).toEqual({ type: "text", text: "→ more" })
    expect(bullets.items.map((i) => i.marker)).toEqual(["•", "•"])
  })

  it("keeps code fences as written", () => {
    expect(parseMarkdown("```\n**not bold**\n```")).toEqual([
      { type: "code", text: "**not bold**" },
    ])
  })

  it("closes bold and code a reply is halfway through", () => {
    expect(closeOpenMarks("**CI fail")).toBe("**CI fail**")
    expect(closeOpenMarks("see `arka")).toBe("see `arka`")
    expect(closeOpenMarks("done **")).toBe("done ")
    expect(closeOpenMarks("**ok**")).toBe("**ok**")
  })
})
