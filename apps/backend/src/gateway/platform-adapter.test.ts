import { describe, expect, it } from "bun:test"
import { markdownToTelegramHtml } from "./platform-adapter.js"

// Telegram's HTML parse_mode renders <b>/<i>/<a>/<code> instead of forcing plain
// text — so the model's markdown becomes real formatting instead of being
// stripped down to a wall of prose. Only a handful of tags are supported and any
// unescaped <, >, or & breaks the whole message, so escaping comes first.
describe("markdownToTelegramHtml", () => {
  it("escapes raw HTML special characters", () => {
    expect(markdownToTelegramHtml("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d")
  })

  it("converts **bold** and __bold__ to <b>", () => {
    expect(markdownToTelegramHtml("this is **bold** text")).toBe("this is <b>bold</b> text")
    expect(markdownToTelegramHtml("this is __bold__ text")).toBe("this is <b>bold</b> text")
  })

  it("converts *italic* and _italic_ to <i>", () => {
    expect(markdownToTelegramHtml("this is *important* text")).toBe("this is <i>important</i> text")
    expect(markdownToTelegramHtml("this is _important_ text")).toBe("this is <i>important</i> text")
  })

  it("converts ~~strikethrough~~ to <s>", () => {
    expect(markdownToTelegramHtml("~~old price~~ new price")).toBe("<s>old price</s> new price")
  })

  it("converts inline code to <code>, escaping its contents", () => {
    expect(markdownToTelegramHtml("run `bun test` now")).toBe("run <code>bun test</code> now")
    expect(markdownToTelegramHtml("use `a < b`")).toBe("use <code>a &lt; b</code>")
  })

  it("converts a fenced code block to <pre>", () => {
    expect(markdownToTelegramHtml("```\nconst x = 1\n```")).toBe("<pre>const x = 1</pre>")
  })

  it("converts a markdown link to <a href>, keeping underscores in the url intact", () => {
    const url = "https://drive.google.com/file/d/abc_123/view"
    expect(markdownToTelegramHtml(`[the PDF](${url})`)).toBe(`<a href="${url}">the PDF</a>`)
  })

  it("leaves a bare url with underscores intact instead of treating them as emphasis", () => {
    const url = "https://drive.google.com/file/d/1jyc_HIIY_KGcPycb_Hiukju/view?usp=drivesdk"
    expect(markdownToTelegramHtml(`Your PDF: ${url}`)).toContain(url)
  })

  it("keeps underscores inside a filename outside any url", () => {
    expect(markdownToTelegramHtml("Created Ada_29_PS2.pdf")).toContain("Ada_29_PS2.pdf")
  })

  it("escapes & in a bare url's query string", () => {
    expect(markdownToTelegramHtml("see https://example.com?a=1&b=2")).toBe(
      "see https://example.com?a=1&amp;b=2",
    )
  })

  it("converts a bullet list to bullet points on their own lines", () => {
    expect(markdownToTelegramHtml("- first\n- second")).toBe("• first\n• second")
  })

  it("does not mis-parse an italic word inside an asterisk-bulleted item", () => {
    expect(markdownToTelegramHtml("* buy *milk* today")).toBe("• buy <i>milk</i> today")
  })

  it("converts a header to a bold line", () => {
    expect(markdownToTelegramHtml("## Top email")).toBe("<b>Top email</b>")
  })

  it("drops markdown images entirely", () => {
    expect(markdownToTelegramHtml("![alt text](https://example.com/x.png)")).toBe("")
  })

  it("collapses 3+ blank lines down to one blank line", () => {
    expect(markdownToTelegramHtml("a\n\n\n\nb")).toBe("a\n\nb")
  })
})
