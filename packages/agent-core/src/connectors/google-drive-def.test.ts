import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  createDriveTools,
  markdownToHtml,
  parseMarkdownSlides,
  parseTableContent,
} from "./google-drive-def.js"

const originalFetch = globalThis.fetch
let requests: { url: string; method: string; body: string }[] = []

function executeTool(name: string, args: Record<string, unknown>) {
  const tools = createDriveTools({
    userId: "user_1",
    getAccessToken: async () => "drive-token",
  })
  const tool = tools[name] as { execute: (args: Record<string, unknown>) => Promise<unknown> }
  return tool.execute(args)
}

beforeEach(() => {
  requests = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    let body = ""
    if (typeof init?.body === "string") body = init.body
    else if (init?.body instanceof Blob) body = await init.body.text()
    requests.push({ url, method: init?.method ?? "GET", body })

    if (url.includes("slides.googleapis.com") && url.includes("fields=slides.objectId")) {
      return Response.json({ slides: [{ objectId: "default_slide" }] })
    }
    if (url.includes("drive/v3/files") || url.includes("upload/drive/v3/files")) {
      return Response.json({
        id: "file_1",
        name: "created",
        webViewLink: "https://drive.google.com/file/d/file_1",
      })
    }
    return Response.json({})
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("parseMarkdownSlides", () => {
  it("splits on --- separators with headings as titles", () => {
    const slides = parseMarkdownSlides(
      "# Intro\nWelcome\n\n---\n\n## Details\n- point one\n- point two\n\n---\n\nNo heading here\njust text",
    )
    expect(slides).toHaveLength(3)
    expect(slides[0]).toMatchObject({ title: "Intro", body: "Welcome" })
    expect(slides[1]?.title).toBe("Details")
    expect(slides[1]?.body).toContain("• point one")
    expect(slides[2]).toMatchObject({ title: "No heading here", body: "just text" })
  })

  it("falls back to splitting on top-level headings", () => {
    const slides = parseMarkdownSlides("# One\na\n# Two\nb")
    expect(slides.map((s) => s.title)).toEqual(["One", "Two"])
  })
})

describe("parseTableContent", () => {
  it("parses CSV with quoted fields", () => {
    expect(parseTableContent('name,note\nAda,"loves, commas"\nBob,plain')).toEqual([
      ["name", "note"],
      ["Ada", "loves, commas"],
      ["Bob", "plain"],
    ])
  })

  it("prefers tabs when present", () => {
    expect(parseTableContent("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })
})

describe("markdownToHtml", () => {
  it("renders headings, lists, emphasis, and links", () => {
    const html = markdownToHtml("# Title\nHello **world** with [a link](https://x.dev)\n- item")
    expect(html).toContain("<h1>Title</h1>")
    expect(html).toContain("<strong>world</strong>")
    expect(html).toContain('<a href="https://x.dev">a link</a>')
    expect(html).toContain("<ul><li>item</li></ul>")
  })

  it("escapes raw HTML in the source", () => {
    expect(markdownToHtml("<script>alert(1)</script>")).toContain("&lt;script&gt;")
  })
})

describe("drive-createFile", () => {
  it("builds a multi-slide deck and removes the default slide", async () => {
    const result = (await executeTool("drive-createFile", {
      name: "Deck",
      kind: "presentation",
      content: "# One\na\n\n---\n\n# Two\nb",
    })) as { id?: string; note?: string }

    expect(result.id).toBe("file_1")
    expect(result.note).toBeUndefined()

    const batch = requests.find((r) => r.url.includes(":batchUpdate"))
    expect(batch).toBeDefined()
    const { requests: slideRequests } = JSON.parse(batch!.body) as {
      requests: Record<string, unknown>[]
    }
    const creates = slideRequests.filter((r) => r["createSlide"])
    expect(creates).toHaveLength(2)
    const inserts = slideRequests.filter((r) => r["insertText"])
    expect(inserts.length).toBe(4) // title + body per slide
    expect(slideRequests.at(-1)).toEqual({ deleteObject: { objectId: "default_slide" } })
  })

  it("writes CSV content as a 2D range starting at A1", async () => {
    await executeTool("drive-createFile", {
      name: "Budget",
      kind: "spreadsheet",
      content: "item,cost\nrent,1200",
    })
    const put = requests.find((r) => r.url.includes("sheets.googleapis.com"))
    expect(put?.method).toBe("PUT")
    expect(put?.url).toContain("values/A1?valueInputOption=USER_ENTERED")
    expect(JSON.parse(put!.body)).toEqual({
      values: [
        ["item", "cost"],
        ["rent", "1200"],
      ],
    })
  })

  it("imports documents as HTML so markdown formatting survives", async () => {
    await executeTool("drive-createFile", {
      name: "Notes",
      kind: "document",
      content: "# Heading\nBody text",
    })
    const upload = requests.find((r) => r.url.includes("upload/drive/v3/files"))
    expect(upload?.body).toContain("Content-Type: text/html; charset=UTF-8")
    expect(upload?.body).toContain("<h1>Heading</h1>")
  })
})
